(function () {
  'use strict';

  /* ---------- theme ---------- */

  var THEME_KEY = 'chronos-ai-theme';
  var THEME_COLORS = { dark: '#101318', light: '#FAF7F2' };
  var root = document.documentElement;
  var themeToggle = document.getElementById('themeToggle');
  var themeColorMeta = document.querySelector('meta[name="theme-color"]');

  function currentTheme() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function paintTheme(theme, persist) {
    var next = theme === 'light' ? 'light' : 'dark';

    root.setAttribute('data-theme', next);

    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', THEME_COLORS[next]);
    }

    if (themeToggle) {
      var toLight = next === 'dark';
      var action = toLight ? 'Switch to light mode' : 'Switch to dark mode';
      themeToggle.setAttribute('aria-pressed', toLight ? 'true' : 'false');
      themeToggle.setAttribute('title', action);
      themeToggle.setAttribute('aria-label', 'Dark mode');
      themeToggle.setAttribute('data-action', action);
    }

    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (error) {
        /* storage unavailable: the theme still applies for this page view */
      }
    }
  }

  /* the inline head script has already resolved the theme; sync the control to it */
  paintTheme(currentTheme(), false);

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      paintTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    });
  }

  /* ---------- offline shell ---------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('./service-worker.js', { scope: './' })
        .catch(function (error) {
          console.warn('Chronos offline shell could not be registered.', error);
        });
    });
  }

  /* ---------- mobile navigation ---------- */

  var menuToggle = document.getElementById('menuToggle');
  var nav = document.getElementById('nav');

  if (menuToggle && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open);
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    };

    menuToggle.addEventListener('click', function () {
      setOpen(!nav.classList.contains('open'));
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false);
        menuToggle.focus();
      }
    });

    document.addEventListener('click', function (event) {
      if (!nav.classList.contains('open')) return;
      if (nav.contains(event.target) || menuToggle.contains(event.target)) return;
      setOpen(false);
    });

    var desktop = window.matchMedia('(min-width: 681px)');
    var handleBreakpoint = function (event) {
      if (event.matches) setOpen(false);
    };
    if (typeof desktop.addEventListener === 'function') {
      desktop.addEventListener('change', handleBreakpoint);
    } else if (typeof desktop.addListener === 'function') {
      desktop.addListener(handleBreakpoint);
    }
  }

  /* ---------- install prompt ---------- */

  var installButton = document.getElementById('pwaInstallButton');
  var installHelp = document.getElementById('pwaInstallHelp');
  var installHelpDismiss = document.getElementById('pwaInstallHelpDismiss');
  var isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  var deferredPrompt = null;

  if (installButton && !isStandalone) {
    if (isIos) installButton.hidden = false;

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;
      installButton.hidden = false;
    });

    installButton.addEventListener('click', async function () {
      if (isIos) {
        if (installHelp) {
          installHelp.hidden = false;
          installHelp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }

      if (!deferredPrompt) return;
      var prompt = deferredPrompt;
      deferredPrompt = null;
      installButton.hidden = true;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch (error) {
        console.warn('Chronos installation prompt could not be completed.', error);
      }
    });

    if (installHelpDismiss && installHelp) {
      installHelpDismiss.addEventListener('click', function () {
        installHelp.hidden = true;
      });
    }

    window.addEventListener('appinstalled', function () {
      installButton.hidden = true;
      if (installHelp) installHelp.hidden = true;
    });
  }

  /* ---------- footer year ---------- */

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();