export function waitForIdle(quietMs = 500, timeoutMs = 12000): Promise<void> {
  return new Promise((resolve) => {
    let idleTimer = 0;
    let finished = false;

    const done = () => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearTimeout(idleTimer);
      window.clearTimeout(maxTimer);
      resolve();
    };

    const bump = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(done, quietMs);
    };

    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    const maxTimer = window.setTimeout(done, timeoutMs);
    bump();
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function onSpaNavigation(callback: () => void): () => void {
  let last = location.href;
  const timer = window.setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      callback();
    }
  }, 400);

  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = function pushState(...args) {
    push(...args);
    callback();
  };
  history.replaceState = function replaceState(...args) {
    replace(...args);
    callback();
  };
  window.addEventListener("popstate", callback);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("popstate", callback);
    history.pushState = push;
    history.replaceState = replace;
  };
}
