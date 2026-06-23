// PodContext - Content Script

let capturedTokens = {
  authorization: null,
  clientToken: null
};

// Inject script to intercept fetch requests and capture tokens
function injectTokenInterceptor() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// Listen for tokens from injected script
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SPOTIFY_TOKENS') {
    capturedTokens.authorization = event.data.authorization;
    capturedTokens.clientToken = event.data.clientToken;
  }
});

// Extract episode ID from URL
function getEpisodeId() {
  const match = window.location.pathname.match(/\/episode\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function getSectionTitle(section) {
  if (!section || !section.title) return '';
  return section.title.title || section.title.text || section.title.name || '';
}

function getSectionSentence(section) {
  if (!section || !section.text) return null;

  const sentence = section.text.sentence || section.text;
  const text = typeof sentence === 'string' ? sentence : sentence.text;
  if (!text || !text.trim()) return null;

  return {
    startMs: Number(sentence.startMs ?? section.startMs ?? 0),
    text: text.trim()
  };
}

function formatTimestamp(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function cleanSpotifyText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/(?<=[\p{Script=Han}，。！？；：“”‘’（）《》、])\s+(?=[\p{Script=Han}，。！？；：“”‘’（）《》、])/gu, '')
    .replace(/(?<=[\p{Script=Han}])\s+(?=[，。！？；：、）])/gu, '')
    .replace(/(?<=[（《“‘])\s+(?=[\p{Script=Han}])/gu, '')
    .replace(/(?<=[\p{Script=Han}])\s+(?=[A-Za-z0-9])/gu, '')
    .replace(/(?<=[A-Za-z0-9])\s+(?=[\p{Script=Han}])/gu, '')
    .trim();
}

function isSpeakerTitle(title) {
  return title.startsWith('Speaker') || /^[A-Z][a-z]+ [A-Z][a-z]+/.test(title);
}

// Extract unique speakers from transcript data
function extractSpeakers(data) {
  const speakers = new Set();
  const sections = data.section || [];

  for (const section of sections) {
    const title = getSectionTitle(section);
    if (title && isSpeakerTitle(title)) {
      speakers.add(title);
    }
  }

  return Array.from(speakers).sort();
}

// Parse transcript JSON into readable text with custom speaker names
function parseTranscript(data, speakerMap = {}) {
  const sections = data.section || [];
  if (!sections.length) return '';

  const result = [];
  let currentSpeaker = null;

  for (const section of sections) {
    const title = getSectionTitle(section);
    if (title && isSpeakerTitle(title)) {
      currentSpeaker = title;
      continue;
    }

    const sentence = getSectionSentence(section);
    if (!sentence) continue;

    const timestamp = formatTimestamp(sentence.startMs);
    const text = cleanSpotifyText(sentence.text);
    if (!text) continue;

    if (currentSpeaker) {
      const displayName = speakerMap[currentSpeaker] || currentSpeaker;
      result.push(`[${timestamp}] ${displayName}: ${text}`);
    } else {
      result.push(`[${timestamp}] ${text}`);
    }
  }

  return result.join('\n');
}

function parseVisibleTranscriptFromPage() {
  const main = document.querySelector('main');
  const pageText = main ? main.innerText : document.body.innerText;
  if (!pageText) return '';

  const startMarkers = [
    '此文字记录自动生成，其准确性无法保证。',
    'This transcript was generated automatically',
    'Transcript'
  ];
  const endMarkers = [
    '更多同类单曲/单集',
    'More episodes like this',
    '显示全部'
  ];
  const timePattern = /^\d{1,2}:\d{2}(?::\d{2})?$/;

  let transcriptText = pageText;
  for (const marker of startMarkers) {
    const index = transcriptText.indexOf(marker);
    if (index !== -1) {
      transcriptText = transcriptText.slice(index + marker.length);
      break;
    }
  }

  let endIndex = transcriptText.length;
  for (const marker of endMarkers) {
    const index = transcriptText.indexOf(marker);
    if (index !== -1 && index < endIndex) {
      endIndex = index;
    }
  }
  transcriptText = transcriptText.slice(0, endIndex);

  const lines = transcriptText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const result = [];
  let currentTime = null;
  let currentText = [];

  function flushCurrent() {
    const text = cleanSpotifyText(currentText.join(' '));
    if (currentTime && text) {
      result.push(`[${currentTime}] ${text}`);
    }
  }

  for (const line of lines) {
    if (timePattern.test(line)) {
      flushCurrent();
      currentTime = line;
      currentText = [];
    } else if (currentTime) {
      currentText.push(line);
    }
  }
  flushCurrent();

  return result.join('\n');
}

// Fetch transcript via background worker
async function fetchTranscript(episodeId) {
  if (!capturedTokens.authorization || !capturedTokens.clientToken) {
    throw new Error('Auth tokens not captured yet. Please interact with the page (play/pause, click around) and try again.');
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'fetchTranscript',
        episodeId: episodeId,
        tokens: capturedTokens
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error));
        }
      }
    );
  });
}

// Download text as file
function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Get episode title from page
function getEpisodeTitle() {
  const title = document.title || 'transcript';
  return title.replace(/\s*\|\s*Podcast on Spotify$/i, '').trim();
}

function sanitizeFilename(name) {
  return (name || 'transcript')
    .replace(/[\\/:*?"<>|#%{}]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'transcript';
}

// Show speaker editor modal
function showSpeakerEditor(speakers, onConfirm, onCancel) {
  const overlay = document.createElement('div');
  overlay.id = 'podcontext-overlay';

  const modal = document.createElement('div');
  modal.id = 'podcontext-modal';

  modal.innerHTML = `
    <h2>Edit Speaker Names</h2>
    <p>Optionally rename the speakers, or skip to download with defaults:</p>
    <div id="podcontext-speakers"></div>
    <div id="podcontext-buttons">
      <button id="podcontext-cancel">Cancel</button>
      <button id="podcontext-skip">Skip</button>
      <button id="podcontext-download">Download</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const speakersDiv = modal.querySelector('#podcontext-speakers');
  speakers.forEach(speaker => {
    const row = document.createElement('div');
    row.className = 'podcontext-speaker-row';
    row.innerHTML = `
      <label>${speaker}:</label>
      <input type="text" data-speaker="${speaker}" value="${speaker}" placeholder="Enter name...">
    `;
    speakersDiv.appendChild(row);
  });

  const firstInput = speakersDiv.querySelector('input');
  if (firstInput) firstInput.focus();

  modal.querySelector('#podcontext-cancel').addEventListener('click', () => {
    overlay.remove();
    onCancel();
  });

  modal.querySelector('#podcontext-skip').addEventListener('click', () => {
    overlay.remove();
    onConfirm({});
  });

  modal.querySelector('#podcontext-download').addEventListener('click', () => {
    const speakerMap = {};
    modal.querySelectorAll('input[data-speaker]').forEach(input => {
      const original = input.dataset.speaker;
      const newName = input.value.trim() || original;
      speakerMap[original] = newName;
    });
    overlay.remove();
    onConfirm(speakerMap);
  });

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      modal.querySelector('#podcontext-download').click();
    } else if (e.key === 'Escape') {
      modal.querySelector('#podcontext-cancel').click();
    }
  });
}

// Create and inject the download button
function injectDownloadButton() {
  if (document.getElementById('podcontext-btn')) {
    return;
  }

  const episodeId = getEpisodeId();
  if (!episodeId) {
    return;
  }

  const button = document.createElement('button');
  button.id = 'podcontext-btn';
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3v10.586l3.293-3.293 1.414 1.414L12 16.414l-4.707-4.707 1.414-1.414L12 13.586V3z"/>
      <path d="M3 17v4h18v-4h-2v2H5v-2H3z"/>
    </svg>
    <span>Download Transcript</span>
  `;
  button.title = 'Download podcast transcript as text file';

  button.addEventListener('click', async () => {
    const originalText = button.querySelector('span').textContent;

    try {
      button.disabled = true;
      button.querySelector('span').textContent = 'Fetching...';

      const episodeId = getEpisodeId();
      if (!episodeId) {
        throw new Error('Could not find episode ID');
      }

      let data = null;
      let apiError = null;

      try {
        data = await fetchTranscript(episodeId);
      } catch (error) {
        apiError = error;
        console.warn('Spotify transcript API failed, trying visible page transcript:', error);
      }

      button.querySelector('span').textContent = originalText;
      button.disabled = false;

      if (!data) {
        const text = parseVisibleTranscriptFromPage();
        if (!text.trim()) {
          throw apiError || new Error('Transcript is empty. Open the Transcript tab on Spotify and try again.');
        }
        const title = sanitizeFilename(getEpisodeTitle());
        downloadText(text, `${title}_transcript.txt`);
        return;
      }

      const speakers = extractSpeakers(data);
      if (speakers.length > 0) {
        showSpeakerEditor(speakers,
          (speakerMap) => {
            const text = parseTranscript(data, speakerMap) || parseVisibleTranscriptFromPage();
            if (!text.trim()) {
              alert('Transcript is empty');
              return;
            }
            const title = sanitizeFilename(getEpisodeTitle());
            downloadText(text, `${title}_transcript.txt`);
          },
          () => {}
        );
      } else {
        const text = parseTranscript(data) || parseVisibleTranscriptFromPage();
        if (!text.trim()) {
          throw new Error('Transcript is empty');
        }
        const title = sanitizeFilename(getEpisodeTitle());
        downloadText(text, `${title}_transcript.txt`);
      }
    } catch (error) {
      console.error('Transcript download error:', error);
      button.querySelector('span').textContent = 'Error!';
      alert(`Failed to download transcript: ${error.message}`);
      setTimeout(() => {
        button.querySelector('span').textContent = originalText;
      }, 2000);
      button.disabled = false;
    }
  });

  const insertButton = () => {
    const actionBar = document.querySelector('[data-testid="action-bar-row"]') ||
                      document.querySelector('[data-testid="episode-play-button"]')?.parentElement?.parentElement;

    if (actionBar && !document.getElementById('podcontext-btn')) {
      actionBar.appendChild(button);
      return true;
    }
    return false;
  };

  if (!insertButton()) {
    const observer = new MutationObserver((mutations, obs) => {
      if (insertButton()) {
        obs.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }
}

// Initialize
function init() {
  injectTokenInterceptor();

  const checkAndInject = () => {
    if (getEpisodeId()) {
      injectDownloadButton();
    }
  };

  checkAndInject();

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const oldBtn = document.getElementById('podcontext-btn');
      if (oldBtn) oldBtn.remove();
      checkAndInject();
    }
  }).observe(document.body, { subtree: true, childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
