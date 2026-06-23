// Injected into YouTube page context to capture ytInitialPlayerResponse and cookies
(function() {
  // Capture YouTube's initial data which contains video metadata
  function captureYouTubeData() {
    const data = {
      type: 'YOUTUBE_DATA'
    };

    // Get ytInitialPlayerResponse which has video info
    if (window.ytInitialPlayerResponse) {
      data.playerResponse = window.ytInitialPlayerResponse;
    }

    // Get ytcfg which has client config
    if (window.ytcfg && window.ytcfg.get) {
      data.clientConfig = {
        INNERTUBE_API_KEY: window.ytcfg.get('INNERTUBE_API_KEY'),
        INNERTUBE_CONTEXT: window.ytcfg.get('INNERTUBE_CONTEXT'),
        INNERTUBE_CONTEXT_CLIENT_NAME: window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME'),
        INNERTUBE_CONTEXT_CLIENT_VERSION: window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION'),
        VISITOR_DATA: window.ytcfg.get('VISITOR_DATA'),
        ID_TOKEN: window.ytcfg.get('ID_TOKEN'),
        LOGGED_IN: window.ytcfg.get('LOGGED_IN'),
        PAGE_BUILD_LABEL: window.ytcfg.get('PAGE_BUILD_LABEL'),
        PAGE_CL: window.ytcfg.get('PAGE_CL'),
        DELEGATED_SESSION_ID: window.ytcfg.get('DELEGATED_SESSION_ID')
      };
    }

    // Get ytInitialData which has transcript params
    if (window.ytInitialData) {
      data.initialData = window.ytInitialData;
    }

    window.postMessage(data, '*');
  }

  // Also intercept fetch to capture auth headers
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const [url, options] = args;
    
    // Capture headers from transcript requests
    if (url && url.includes && url.includes('get_transcript')) {
      if (options && options.headers) {
        const headers = options.headers;
        window.postMessage({
          type: 'YOUTUBE_TRANSCRIPT_HEADERS',
          headers: headers
        }, '*');
      }
    }
    
    return originalFetch.apply(this, args);
  };

  // Send data immediately and on navigation
  if (document.readyState === 'complete') {
    captureYouTubeData();
  } else {
    window.addEventListener('load', captureYouTubeData);
  }

  // Also capture on navigation (YouTube is an SPA)
  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    setTimeout(captureYouTubeData, 1000);
  };

  // Re-capture when video changes
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(captureYouTubeData, 500);
  });
})();
