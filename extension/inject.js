// Injected into page context to intercept fetch requests
(function() {
  const originalFetch = window.fetch;

  function getHeader(headers, name) {
    if (!headers) return null;

    if (headers instanceof Headers) {
      return headers.get(name);
    }

    if (Array.isArray(headers)) {
      const entry = headers.find(([key]) => key && key.toLowerCase() === name.toLowerCase());
      return entry ? entry[1] : null;
    }

    if (typeof headers === 'object') {
      return headers[name] || headers[name.toLowerCase()] || headers[name.replace(/(^|-)([a-z])/g, (_, dash, char) => dash + char.toUpperCase())];
    }

    return null;
  }

  function postTokens(auth, clientToken) {
    if (!auth || !clientToken) return;

    window.postMessage({
      type: 'SPOTIFY_TOKENS',
      authorization: auth,
      clientToken: clientToken
    }, '*');
  }

  window.fetch = function(...args) {
    const [request, options] = args;
    const optionHeaders = options && options.headers;
    const requestHeaders = request && typeof request === 'object' ? request.headers : null;

    const auth = getHeader(optionHeaders, 'authorization') || getHeader(requestHeaders, 'authorization');
    const clientToken = getHeader(optionHeaders, 'client-token') || getHeader(requestHeaders, 'client-token');
    postTokens(auth, clientToken);

    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(...args) {
    this.__podcontextHeaders = {};
    return originalOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this.__podcontextHeaders && name) {
      this.__podcontextHeaders[name.toLowerCase()] = value;
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    const headers = this.__podcontextHeaders || {};
    postTokens(headers.authorization, headers['client-token']);
    return originalSend.apply(this, args);
  };
})();
