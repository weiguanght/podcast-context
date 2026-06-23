// PodContext - Background Service Worker
// Handles transcript fetching for Spotify and YouTube

// Handle transcript fetch requests from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchTranscript') {
    // Spotify transcript fetch
    fetchSpotifyTranscript(request.episodeId, request.tokens)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'fetchYouTubeTranscript') {
    // YouTube transcript fetch
    fetchYouTubeTranscript(request.videoId, request.clientConfig, request.transcriptParams, request.cookies)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Spotify transcript fetch
async function fetchSpotifyTranscript(episodeId, tokens) {
  const url = `https://spclient.wg.spotify.com/transcript-read-along/v2/episode/${episodeId}?format=json&maxSentenceLength=100&excludeCC=false`;

  const response = await fetch(url, {
    headers: {
      'authorization': tokens.authorization,
      'client-token': tokens.clientToken,
      'accept': 'application/json',
      'accept-language': 'en-GB'
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('No transcript available for this episode');
    }
    if (response.status === 401) {
      throw new Error('Authentication failed. Please refresh the page and try again.');
    }
    throw new Error(`Failed to fetch transcript: ${response.status}`);
  }

  return response.json();
}

// YouTube transcript fetch
async function fetchYouTubeTranscript(videoId, clientConfig, transcriptParams, cookies) {
  console.log('[PodContext Background] Fetching transcript for video:', videoId);

  // Try the timedtext API first (works without authentication)
  try {
    console.log('[PodContext Background] Trying timedtext API...');
    const timedTextResult = await fetchYouTubeTimedText(videoId);
    console.log('[PodContext Background] Timedtext API succeeded');
    return timedTextResult;
  } catch (timedTextError) {
    console.log('[PodContext Background] Timedtext API failed:', timedTextError.message);
    // If timedtext fails, try the transcript API
  }

  // Fall back to internal transcript API (may require auth)
  console.log('[PodContext Background] Trying internal transcript API...');
  const url = 'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false';

  // Build the context from captured config
  const context = clientConfig.INNERTUBE_CONTEXT || {};

  // If we don't have a proper context, build a minimal one
  if (!context.client) {
    context.client = {
      hl: 'en',
      gl: 'US',
      clientName: 'WEB',
      clientVersion: clientConfig.INNERTUBE_CONTEXT_CLIENT_VERSION || '2.20260105.01.00',
      platform: 'DESKTOP'
    };
  }

  // Build the request body
  const body = {
    context: context,
    params: transcriptParams,
    languageCode: 'en',
    externalVideoId: videoId
  };

  // Build headers
  const headers = {
    'accept': '*/*',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'content-type': 'application/json',
    'x-origin': 'https://www.youtube.com',
    'x-youtube-client-name': String(clientConfig.INNERTUBE_CONTEXT_CLIENT_NAME || 1),
    'x-youtube-client-version': clientConfig.INNERTUBE_CONTEXT_CLIENT_VERSION || '2.20260105.01.00'
  };

  // Add visitor data if available
  if (clientConfig.VISITOR_DATA) {
    headers['x-goog-visitor-id'] = clientConfig.VISITOR_DATA;
  }

  // Try to fetch the transcript
  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    credentials: 'include'
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('No transcript available for this video');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication failed. This video may not have public captions available.');
    }
    throw new Error(`Failed to fetch transcript: ${response.status}`);
  }

  const data = await response.json();

  // Check if we actually got transcript data
  if (!data.actions || data.actions.length === 0) {
    throw new Error('No transcript data returned from API');
  }

  return data;
}

// Alternative: Fetch from YouTube's timedtext API (for auto-generated captions)
async function fetchYouTubeTimedText(videoId) {
  console.log('[PodContext Background] fetchYouTubeTimedText called for:', videoId);

  // First, get the video page to find caption tracks
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log('[PodContext Background] Fetching page:', pageUrl);

  const pageResponse = await fetch(pageUrl);
  if (!pageResponse.ok) {
    throw new Error(`Failed to fetch video page: ${pageResponse.status}`);
  }

  const pageHtml = await pageResponse.text();
  console.log('[PodContext Background] Got page HTML, length:', pageHtml.length);

  // Try multiple patterns to find caption tracks
  let captionTracks = null;

  // Pattern 1: Look for captionTracks in ytInitialPlayerResponse
  // Use a proper brace-counting approach instead of broken regex
  const playerResponseStart = pageHtml.indexOf('ytInitialPlayerResponse');
  if (playerResponseStart !== -1) {
    try {
      // Find the start of the JSON object
      const jsonStart = pageHtml.indexOf('{', playerResponseStart);
      if (jsonStart !== -1) {
        // Count braces to find the complete JSON object
        let braceCount = 0;
        let jsonEnd = jsonStart;
        let inString = false;
        let escapeNext = false;

        for (let i = jsonStart; i < pageHtml.length && i < jsonStart + 500000; i++) {
          const char = pageHtml[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\' && inString) {
            escapeNext = true;
            continue;
          }

          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;

            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }

        if (braceCount === 0 && jsonEnd > jsonStart) {
          const jsonStr = pageHtml.substring(jsonStart, jsonEnd);
          console.log('[PodContext Background] Extracted JSON length:', jsonStr.length);
          const playerResponse = JSON.parse(jsonStr);
          captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (captionTracks) {
            console.log('[PodContext Background] Found caption tracks in ytInitialPlayerResponse');
          } else {
            console.log('[PodContext Background] ytInitialPlayerResponse parsed but no captionTracks found');
          }
        }
      }
    } catch (e) {
      console.log('[PodContext Background] Failed to parse ytInitialPlayerResponse:', e.message);
    }
  }

  // Pattern 2: Direct captionTracks search with improved regex
  if (!captionTracks) {
    // This regex finds the captionTracks array more robustly
    const captionMatch = pageHtml.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"audioTracks"/);
    if (captionMatch) {
      try {
        captionTracks = JSON.parse(captionMatch[1]);
        console.log('[PodContext Background] Found caption tracks via regex pattern 2');
      } catch (e) {
        console.log('[PodContext Background] Failed to parse captionTracks pattern 2:', e.message);
      }
    }
  }

  // Pattern 3: Alternative pattern
  if (!captionTracks) {
    const captionMatch2 = pageHtml.match(/"captionTracks":\s*(\[\{"baseUrl"[\s\S]*?\}\])/);
    if (captionMatch2) {
      try {
        captionTracks = JSON.parse(captionMatch2[1]);
        console.log('[PodContext Background] Found caption tracks via regex pattern 3');
      } catch (e) {
        console.log('[PodContext Background] Failed to parse captionTracks pattern 3:', e.message);
      }
    }
  }

  // Pattern 4: Look for timedtext URL directly
  if (!captionTracks) {
    const timedtextMatch = pageHtml.match(/https:\/\/www\.youtube\.com\/api\/timedtext[^"]+/g);
    if (timedtextMatch && timedtextMatch.length > 0) {
      console.log('[PodContext Background] Found timedtext URLs directly');
      // Decode the URL and use it directly
      let timedtextUrl = timedtextMatch[0].replace(/\\u0026/g, '&');

      console.log('[PodContext Background] Fetching timedtext from:', timedtextUrl);
      const captionResponse = await fetch(timedtextUrl + '&fmt=json3');
      if (captionResponse.ok) {
        const captionData = await captionResponse.json();
        return convertTimedTextToTranscript(captionData, videoId);
      }
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    console.log('[PodContext Background] No caption tracks found in any pattern');
    throw new Error('No captions found for this video. The video may not have transcripts available.');
  }

  console.log('[PodContext Background] Found', captionTracks.length, 'caption tracks');

  // Find English captions (prefer manual over auto-generated)
  let track = captionTracks.find(t => t.languageCode === 'en' && !t.kind);
  if (!track) {
    track = captionTracks.find(t => t.languageCode === 'en');
  }
  if (!track) {
    track = captionTracks.find(t => t.languageCode?.startsWith('en'));
  }
  if (!track) {
    track = captionTracks[0]; // Fallback to first available
  }

  console.log('[PodContext Background] Selected track:', track.languageCode, track.kind || 'manual');

  if (!track.baseUrl) {
    throw new Error('Caption track URL not found');
  }

  // Fetch the captions in JSON3 format
  // Clean up the URL (sometimes it has escaped characters)
  let captionUrl = track.baseUrl.replace(/\\u0026/g, '&');

  console.log('[PodContext Background] Fetching captions...');

  // Try JSON3 format first
  let captionData = null;

  // Try with fmt=json3
  try {
    const json3Url = captionUrl + (captionUrl.includes('?') ? '&' : '?') + 'fmt=json3';
    console.log('[PodContext Background] Trying JSON3 format:', json3Url);

    const captionResponse = await fetch(json3Url, {
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        'Origin': 'https://www.youtube.com'
      },
      credentials: 'include'
    });

    if (captionResponse.ok) {
      const responseText = await captionResponse.text();
      console.log('[PodContext Background] JSON3 response length:', responseText.length);

      if (responseText && responseText.length > 0) {
        captionData = JSON.parse(responseText);
      }
    }
  } catch (e) {
    console.log('[PodContext Background] JSON3 failed:', e.message);
  }

  // If JSON3 failed, try srv3 (XML) format
  if (!captionData) {
    try {
      const srv3Url = captionUrl + (captionUrl.includes('?') ? '&' : '?') + 'fmt=srv3';
      console.log('[PodContext Background] Trying SRV3 (XML) format:', srv3Url);

      const captionResponse = await fetch(srv3Url, {
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
          'Origin': 'https://www.youtube.com'
        },
        credentials: 'include'
      });

      if (captionResponse.ok) {
        const xmlText = await captionResponse.text();
        console.log('[PodContext Background] SRV3 response length:', xmlText.length);
        console.log('[PodContext Background] SRV3 preview:', xmlText.substring(0, 300));

        if (xmlText && xmlText.length > 0) {
          // Parse XML and convert to our format
          captionData = parseXmlCaptions(xmlText);
        }
      }
    } catch (e) {
      console.log('[PodContext Background] SRV3 failed:', e.message);
    }
  }

  // If srv3 also failed, try the base URL without format (usually returns XML)
  if (!captionData) {
    try {
      console.log('[PodContext Background] Trying base URL:', captionUrl);

      const captionResponse = await fetch(captionUrl, {
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
          'Origin': 'https://www.youtube.com'
        },
        credentials: 'include'
      });

      if (captionResponse.ok) {
        const responseText = await captionResponse.text();
        console.log('[PodContext Background] Base URL response length:', responseText.length);
        console.log('[PodContext Background] Base URL preview:', responseText.substring(0, 300));

        if (responseText && responseText.length > 0) {
          // Try to determine format and parse
          if (responseText.trim().startsWith('{')) {
            captionData = JSON.parse(responseText);
          } else if (responseText.trim().startsWith('<')) {
            captionData = parseXmlCaptions(responseText);
          }
        }
      }
    } catch (e) {
      console.log('[PodContext Background] Base URL failed:', e.message);
    }
  }

  if (!captionData) {
    throw new Error('Failed to fetch captions in any format');
  }

  console.log('[PodContext Background] Got caption data with', captionData.events?.length || 0, 'events');

  // Convert to our expected format
  return convertTimedTextToTranscript(captionData, videoId);
}

// Parse XML captions (srv3 format)
function parseXmlCaptions(xmlText) {
  const events = [];

  // Simple regex-based XML parsing for caption entries
  // Format: <p t="start_ms" d="duration_ms">text</p>
  const pTagRegex = /<p[^>]*\bt="(\d+)"[^>]*\bd="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;

  while ((match = pTagRegex.exec(xmlText)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durationMs = parseInt(match[2], 10);
    // Clean up the text (remove nested tags, unescape HTML entities)
    let text = match[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();

    if (text) {
      events.push({
        tStartMs: startMs,
        dDurationMs: durationMs,
        segs: [{ utf8: text }]
      });
    }
  }

  // If no matches with <p>, try <text> format
  if (events.length === 0) {
    const textTagRegex = /<text[^>]*\bstart="([\d.]+)"[^>]*(?:\bdur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;

    while ((match = textTagRegex.exec(xmlText)) !== null) {
      const startMs = Math.round(parseFloat(match[1]) * 1000);
      const durationMs = match[2] ? Math.round(parseFloat(match[2]) * 1000) : 3000;
      let text = match[3]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, ' ')
        .trim();

      if (text) {
        events.push({
          tStartMs: startMs,
          dDurationMs: durationMs,
          segs: [{ utf8: text }]
        });
      }
    }
  }

  console.log('[PodContext Background] Parsed', events.length, 'caption segments from XML');

  return { events };
}

// Convert timedtext JSON3 format to transcript format
function convertTimedTextToTranscript(timedTextData, videoId) {
  const events = timedTextData.events || [];
  const segments = [];

  for (const event of events) {
    if (!event.segs) continue;

    const text = event.segs.map(seg => seg.utf8).join('').trim();
    if (!text) continue;

    const startMs = event.tStartMs || 0;
    const durationMs = event.dDurationMs || 0;
    const startSeconds = Math.floor(startMs / 1000);
    const minutes = Math.floor(startSeconds / 60);
    const seconds = startSeconds % 60;
    const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    segments.push({
      transcriptSegmentRenderer: {
        startMs: String(startMs),
        endMs: String(startMs + durationMs),
        snippet: {
          runs: [{ text: text }]
        },
        startTimeText: {
          simpleText: timeText
        }
      }
    });
  }

  // Return in the same format as the YouTube API
  return {
    actions: [{
      updateEngagementPanelAction: {
        content: {
          transcriptRenderer: {
            content: {
              transcriptSearchPanelRenderer: {
                body: {
                  transcriptSegmentListRenderer: {
                    initialSegments: segments
                  }
                }
              }
            }
          }
        }
      }
    }]
  };
}
