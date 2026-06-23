// PodContext - YouTube Content Script
// Adds download button to YouTube's transcript panel

console.log('[PodContext] YouTube content script loaded');

// Download text as file
function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Get video title from page
function getVideoTitle() {
    const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
        document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
        document.querySelector('#title h1 yt-formatted-string') ||
        document.querySelector('h1.title');

    if (titleElement) {
        return titleElement.textContent.trim();
    }

    const title = document.title || 'transcript';
    return title.replace(/\s*-\s*YouTube$/i, '').trim();
}

// Extract transcript text from the transcript panel
function extractTranscriptFromPanel() {
    const segments = [];

    // Find all transcript segments in the panel
    // YouTube uses ytd-transcript-segment-renderer for each segment
    const segmentElements = document.querySelectorAll('ytd-transcript-segment-renderer');

    if (segmentElements.length === 0) {
        // Try alternative selector for newer YouTube UI
        const altSegments = document.querySelectorAll('[class*="transcript-segment"]');
        if (altSegments.length > 0) {
            altSegments.forEach(segment => {
                const timestamp = segment.querySelector('[class*="timestamp"]')?.textContent?.trim() || '';
                const text = segment.querySelector('[class*="text"]')?.textContent?.trim() || '';
                if (text) {
                    segments.push({ timestamp, text });
                }
            });
        }
    } else {
        segmentElements.forEach(segment => {
            // Get timestamp
            const timestampEl = segment.querySelector('.segment-timestamp');
            const timestamp = timestampEl ? timestampEl.textContent.trim() : '';

            // Get text content
            const textEl = segment.querySelector('.segment-text');
            const text = textEl ? textEl.textContent.trim() : '';

            if (text) {
                segments.push({ timestamp, text });
            }
        });
    }

    // If still no segments, try to find any text content in the transcript panel
    if (segments.length === 0) {
        const transcriptPanel = document.querySelector('ytd-transcript-renderer') ||
            document.querySelector('[target-id="engagement-panel-searchable-transcript"]') ||
            document.querySelector('#panels ytd-engagement-panel-section-list-renderer');

        if (transcriptPanel) {
            // Try to find segments with different selectors
            const allSegments = transcriptPanel.querySelectorAll('ytd-transcript-segment-renderer, [class*="cue"]');

            allSegments.forEach(segment => {
                const allText = segment.textContent.trim();
                // Try to split timestamp from text
                const match = allText.match(/^(\d+:\d+(?::\d+)?)\s*(.*)/s);
                if (match) {
                    segments.push({ timestamp: match[1], text: match[2].trim() });
                } else if (allText) {
                    segments.push({ timestamp: '', text: allText });
                }
            });
        }
    }

    return segments;
}

// Format transcript segments into readable text
function formatTranscript(segments) {
    return segments.map(s => {
        if (s.timestamp) {
            return `[${s.timestamp}] ${s.text}`;
        }
        return s.text;
    }).join('\n');
}

// Create the download button
function createDownloadButton() {
    const button = document.createElement('button');
    button.id = 'podcontext-yt-download';
    button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;">
      <path d="M12 3v10.586l3.293-3.293 1.414 1.414L12 16.414l-4.707-4.707 1.414-1.414L12 13.586V3z"/>
      <path d="M3 17v4h18v-4h-2v2H5v-2H3z"/>
    </svg>
    Download Transcript
  `;
    button.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 8px 16px;
    background-color: #cc0000;
    color: white;
    border: none;
    border-radius: 18px;
    font-size: 14px;
    font-weight: 500;
    font-family: "Roboto", "Arial", sans-serif;
    cursor: pointer;
    margin: 8px;
    transition: background-color 0.2s;
  `;

    button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = '#ff0000';
    });

    button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = '#cc0000';
    });

    button.addEventListener('click', () => {
        const originalText = button.innerHTML;

        try {
            button.innerHTML = 'Extracting...';
            button.disabled = true;

            const segments = extractTranscriptFromPanel();

            if (segments.length === 0) {
                throw new Error('No transcript segments found. Make sure the transcript is fully loaded.');
            }

            const text = formatTranscript(segments);
            const title = getVideoTitle().replace(/[^a-z0-9]/gi, '_').substring(0, 50);
            downloadText(text, `${title}_transcript.txt`);

            console.log(`[PodContext] Downloaded ${segments.length} transcript segments`);

            button.innerHTML = '✓ Downloaded!';
            setTimeout(() => {
                button.innerHTML = originalText;
                button.disabled = false;
            }, 2000);

        } catch (error) {
            console.error('[PodContext] Error extracting transcript:', error);
            button.innerHTML = 'Error!';
            alert(`Failed to extract transcript: ${error.message}`);
            setTimeout(() => {
                button.innerHTML = originalText;
                button.disabled = false;
            }, 2000);
        }
    });

    return button;
}

// Check if download button already exists
function hasDownloadButton() {
    return document.getElementById('podcontext-yt-download') !== null;
}

// Try to inject the download button into the transcript panel
function injectDownloadButton() {
    if (hasDownloadButton()) {
        return true;
    }

    // Look for the transcript panel header area
    const transcriptPanel = document.querySelector('ytd-transcript-renderer');

    if (!transcriptPanel) {
        return false;
    }

    // Find a good place to insert the button
    // Try the header area first
    const headerArea = transcriptPanel.querySelector('#header') ||
        transcriptPanel.querySelector('.header') ||
        transcriptPanel.querySelector('ytd-transcript-search-panel-renderer');

    if (headerArea && !hasDownloadButton()) {
        const button = createDownloadButton();

        // Insert at the beginning or end of the header
        if (headerArea.firstChild) {
            headerArea.insertBefore(button, headerArea.firstChild);
        } else {
            headerArea.appendChild(button);
        }

        console.log('[PodContext] Download button injected into transcript panel header');
        return true;
    }

    // Fallback: insert at the top of the transcript panel itself
    if (!hasDownloadButton()) {
        const button = createDownloadButton();
        transcriptPanel.insertBefore(button, transcriptPanel.firstChild);
        console.log('[PodContext] Download button injected at top of transcript panel');
        return true;
    }

    return false;
}

// Watch for the transcript panel to appear
function watchForTranscriptPanel() {
    console.log('[PodContext] Watching for transcript panel...');

    // Try immediately
    injectDownloadButton();

    // Set up observer to watch for the panel appearing
    const observer = new MutationObserver((mutations, obs) => {
        if (injectDownloadButton()) {
            // Keep observing in case the panel is closed and reopened
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Also check periodically (as backup)
    setInterval(() => {
        if (!hasDownloadButton()) {
            injectDownloadButton();
        }
    }, 2000);
}

// Initialize
function init() {
    console.log('[PodContext] Initializing YouTube transcript downloader...');
    watchForTranscriptPanel();

    // Re-initialize on navigation (YouTube is an SPA)
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            console.log('[PodContext] URL changed, re-checking for transcript panel');
            // Remove old button if exists
            const oldBtn = document.getElementById('podcontext-yt-download');
            if (oldBtn) oldBtn.remove();
        }
    });
    urlObserver.observe(document.body, { subtree: true, childList: true });

    // Listen for YouTube's navigation event
    window.addEventListener('yt-navigate-finish', () => {
        console.log('[PodContext] Navigation finished, re-checking for transcript panel');
        const oldBtn = document.getElementById('podcontext-yt-download');
        if (oldBtn) oldBtn.remove();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
