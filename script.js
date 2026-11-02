const menuToggle = document.getElementById('menuToggle');
const nav = document.getElementById('nav');
if (menuToggle && nav) {
  menuToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    menuToggle.textContent = isOpen ? '×' : '☰';
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
    menuToggle.textContent = '☰';
  }));
}

const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

const accountStatus = document.getElementById('accountStatus');
const accountMessage = document.getElementById('accountMessage');
const accountForm = document.getElementById('accountForm');
const accountEdition = document.getElementById('accountEdition');
const marketSelect = document.getElementById('marketSelect');
const purchaseButtons = [...document.querySelectorAll('[data-checkout-product]')];
const restoreButton = document.getElementById('restorePurchases');
const refreshButton = document.getElementById('refreshEntitlements');
const signOutButton = document.getElementById('signOut');
const configured = window.CHRONOS_CONFIG
  && /^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(window.CHRONOS_CONFIG.supabaseUrl)
  && typeof window.CHRONOS_CONFIG.supabaseAnonKey === 'string'
  && window.CHRONOS_CONFIG.supabaseAnonKey.length > 20;

let client = null;
let currentSession = null;
let currentEntitlements = null;

function showAccountMessage(message, isError = false) {
  if (!accountMessage) return;
  accountMessage.textContent = message;
  accountMessage.classList.toggle('is-error', isError);
}

function setAccountStatus(message) {
  if (accountStatus) accountStatus.textContent = message;
}

function setSignedInControls(signedIn) {
  if (accountForm) accountForm.hidden = signedIn;
  if (restoreButton) restoreButton.hidden = !signedIn;
  if (refreshButton) refreshButton.hidden = !signedIn;
  if (signOutButton) signOutButton.hidden = !signedIn;
}

function selectMarketFromLocale() {
  if (!marketSelect || !navigator.language) return;
  const country = navigator.language.split('-').pop().toUpperCase();
  if ([...marketSelect.options].some(option => option.value === country)) {
    marketSelect.value = country;
  } else if (['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR'].includes(country)) {
    marketSelect.value = 'EZ';
  }
}

function updateOfferButtons() {
  const market = marketSelect?.value;
  const offers = currentEntitlements?.offers ?? [];
  for (const button of purchaseButtons) {
    const productId = button.dataset.checkoutProduct;
    const offer = offers.find(item => item.productId === productId && item.marketCode === market);
    const owned = productId === 'ultimate'
      ? currentEntitlements?.entitlements?.ultimate?.active
      : currentEntitlements?.entitlements?.plus?.active;

    if (owned) {
      button.textContent = 'Already included in your edition';
      button.disabled = true;
      continue;
    }

    const available = Boolean(currentSession && offer?.available);
    button.disabled = !available;
    button.classList.toggle('purchase-disabled', !available);
    if (available) {
      button.textContent = `Buy ${productId === 'ultimate' ? 'Ultimate' : 'Plus'} — ${offer.displayPrice} (one-time)`;
    } else if (productId === 'plus' && !offer) {
      button.textContent = 'Plus price not configured';
    } else if (!currentSession) {
      button.textContent = 'Sign in to check out';
    } else if (offer) {
      button.textContent = 'Unavailable in this market';
    } else {
      button.textContent = 'Price not configured';
    }
  }

  document.querySelectorAll('[data-market]').forEach(item => {
    const marketOffer = offers.find(offer => offer.productId === 'ultimate' && offer.marketCode === item.dataset.market);
    const availability = item.querySelector('.market-availability');
    if (availability) {
      const available = Boolean(marketOffer?.available);
      availability.textContent = available ? 'Available via Paystack' : 'Unavailable until configured';
      availability.classList.toggle('is-available', available);
    }
  });

  const selectedOffer = offers.find(offer => offer.productId === 'ultimate' && offer.marketCode === market);
  const priceLabel = document.getElementById('ultimatePriceLabel');
  if (priceLabel && selectedOffer?.available) {
    priceLabel.textContent = `${selectedOffer.displayPrice} one-time`;
  } else if (priceLabel) {
    priceLabel.textContent = 'price unavailable in this market';
  }
}

async function functionErrorMessage(error) {
  const response = error?.context;
  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json();
      if (typeof body.error === 'string') return body.error;
    } catch {
      return error.message || 'The secure service could not complete the request.';
    }
  }
  return error?.message || 'The secure service could not complete the request.';
}

async function loadEntitlements() {
  const { data, error } = await client.functions.invoke('get-entitlements', { body: {} });
  if (error) throw new Error(await functionErrorMessage(error));
  currentEntitlements = data;
  accountEdition.hidden = false;
  accountEdition.textContent = `Current edition: ${data.edition.toUpperCase()}${data.edition === 'plus' || data.edition === 'ultimate' ? ' · lifetime' : ''}`;
  const accountEmail = data.user?.email ? `Signed in as ${data.user.email}. ` : 'Signed in. ';
  const modeLabel = data.paymentMode === 'test' ? ' Test payment mode is active.' : '';
  const paymentLabel = data.paymentMode === 'unconfigured' ? ' Payment checkout is not configured yet.' : '';
  setAccountStatus(`${accountEmail}${data.edition.toUpperCase()} edition confirmed by Chronos.${modeLabel}${paymentLabel}`);
  updateOfferButtons();
}

async function verifyReturnedPayment() {
  const url = new URL(window.location.href);
  const reference = url.searchParams.get('reference') || url.searchParams.get('trxref');
  if (!reference) return;
  if (!currentSession) {
    showAccountMessage('Sign in to verify this payment. The checkout redirect alone does not grant access.', true);
    return;
  }
  showAccountMessage('Verifying the payment directly with Paystack…');
  const { data, error } = await client.functions.invoke('verify-payment', { body: { reference } });
  if (error) throw new Error(await functionErrorMessage(error));

  if (data.status === 'paid') {
    await loadEntitlements();
    showAccountMessage(`Payment verified. Your ${String(data.edition).toUpperCase()} lifetime edition is active.`);
  } else if (data.status === 'refunded') {
    await loadEntitlements();
    showAccountMessage('This payment was refunded. Paid access is not active.', true);
  } else if (data.status === 'reversed') {
    await loadEntitlements();
    showAccountMessage('This transaction was reversed. Paid access is not active.', true);
  } else if (data.status === 'failed') {
    showAccountMessage('Payment was not completed. No paid access was granted.', true);
  } else {
    showAccountMessage('Payment is still pending. No paid access has been granted; refresh or restore later.');
  }
  url.searchParams.delete('reference');
  url.searchParams.delete('trxref');
  url.searchParams.delete('payment');
  window.history.replaceState({}, '', url);
}

if (marketSelect) {
  selectMarketFromLocale();
  marketSelect.addEventListener('change', updateOfferButtons);
}

if (!configured || !window.supabase?.createClient) {
  setAccountStatus('Secure account and checkout are unavailable until config.js and the Supabase service are configured.');
  purchaseButtons.forEach(button => {
    button.disabled = true;
    if (button.dataset.checkoutProduct === 'ultimate') button.textContent = 'Checkout not configured';
  });
} else {
  client = window.supabase.createClient(
    window.CHRONOS_CONFIG.supabaseUrl,
    window.CHRONOS_CONFIG.supabaseAnonKey,
    { auth: { persistSession: true, autoRefreshToken: true } },
  );

  accountForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const submitter = event.submitter;
    const action = submitter?.dataset.authAction;
    const email = document.getElementById('accountEmail').value.trim();
    const password = document.getElementById('accountPassword').value;
    if (!action) return;

    for (const button of accountForm.querySelectorAll('button[type="submit"]')) button.disabled = true;
    showAccountMessage(action === 'sign-up' ? 'Creating your account…' : 'Signing in…');
    try {
      const result = action === 'sign-up'
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (action === 'sign-up' && !result.data.session) {
        showAccountMessage('Check your email to confirm your account, then sign in here.');
        return;
      }
      currentSession = result.data.session;
      if (currentSession) {
        setSignedInControls(true);
        await loadEntitlements();
        await verifyReturnedPayment();
        showAccountMessage('Your Chronos account is ready.');
      }
    } catch (error) {
      showAccountMessage(error.message || 'Account sign-in failed. Please try again.', true);
    } finally {
      for (const button of accountForm.querySelectorAll('button[type="submit"]')) button.disabled = false;
    }
  });

  signOutButton?.addEventListener('click', async () => {
    const { error } = await client.auth.signOut();
    if (error) {
      showAccountMessage(error.message, true);
      return;
    }
    currentSession = null;
    currentEntitlements = null;
    accountEdition.hidden = true;
    setSignedInControls(false);
    setAccountStatus('Signed out. Sign in to view or restore your edition.');
    showAccountMessage('');
    updateOfferButtons();
  });

  refreshButton?.addEventListener('click', async () => {
    refreshButton.disabled = true;
    showAccountMessage('Refreshing your edition from Supabase…');
    try {
      await loadEntitlements();
      showAccountMessage('Edition status refreshed from the server.');
    } catch (error) {
      showAccountMessage(error.message, true);
    } finally {
      refreshButton.disabled = false;
    }
  });

  restoreButton?.addEventListener('click', async () => {
    restoreButton.disabled = true;
    showAccountMessage('Verifying your purchase history with Paystack…');
    try {
      const { data, error } = await client.functions.invoke('restore-purchases', { body: {} });
      if (error) throw new Error(await functionErrorMessage(error));
      await loadEntitlements();
      const failures = (data.purchases ?? []).filter(item => item.error).length;
      const reversed = (data.purchases ?? []).filter(item => item.status === 'reversed').length;
      showAccountMessage(
        `Checked ${data.checked} purchase(s); ${data.restored} verified paid purchase(s) restored.` +
        (reversed ? ` ${reversed} reversed purchase(s) no longer grant paid access.` : '') +
        (failures ? ` ${failures} could not be verified; retry or contact support.` : ''),
        failures > 0,
      );
    } catch (error) {
      showAccountMessage(error.message, true);
    } finally {
      restoreButton.disabled = false;
    }
  });

  purchaseButtons.forEach(button => button.addEventListener('click', async () => {
    if (!currentSession) {
      showAccountMessage('Sign in or create an account before purchasing.');
      accountForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('accountEmail')?.focus();
      return;
    }
    const market = marketSelect?.value;
    button.disabled = true;
    showAccountMessage('Creating a secure one-time Paystack checkout…');
    try {
      const { data, error } = await client.functions.invoke('create-checkout', {
        body: { product_id: button.dataset.checkoutProduct, market_code: market },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      showAccountMessage(data.mode === 'test' ? 'Opening Paystack test checkout…' : 'Opening Paystack checkout…');
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      showAccountMessage(error.message, true);
      updateOfferButtons();
    }
  }));

  client.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    setSignedInControls(Boolean(session));
    if (!session) {
      currentEntitlements = null;
      if (accountEdition) accountEdition.hidden = true;
      setAccountStatus('Sign in to view your edition and purchase history.');
      updateOfferButtons();
      return;
    }
    queueMicrotask(async () => {
      try {
        await loadEntitlements();
        await verifyReturnedPayment();
      } catch (error) {
        setAccountStatus(error.message);
        showAccountMessage(error.message, true);
      }
    });
  });

  client.auth.getSession().then(async ({ data, error }) => {
    if (error) throw error;
    currentSession = data.session;
    setSignedInControls(Boolean(currentSession));
    updateOfferButtons();
    if (currentSession) {
      try {
        await loadEntitlements();
        await verifyReturnedPayment();
      } catch (loadError) {
        setAccountStatus(loadError.message);
        showAccountMessage(loadError.message, true);
      }
    } else {
      setAccountStatus('Sign in to view your edition and purchase history.');
    }
  }).catch(error => {
    setAccountStatus(error.message || 'Your account session could not be loaded.');
    showAccountMessage(error.message || 'Your account session could not be loaded.', true);
  });
}
