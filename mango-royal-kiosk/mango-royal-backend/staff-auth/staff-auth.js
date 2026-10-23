(() => {
    const config = window.MANGO_ROYAL_STAFF_APP;
    if (!config || !config.apiBase || !config.role || !config.appScript || !config.sessionKey) {
        throw new Error('Staff login is missing app configuration.');
    }

    const apiBase = config.apiBase.replace(/\/+$/, '');
    const sessionKey = config.sessionKey;
    const originalFetch = window.fetch.bind(window);
    let token = '';
    let expiredRedirectStarted = false;

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = `${apiBase}/staff-auth/staff-auth.css`;
    document.head.appendChild(stylesheet);

    function apiUrl(input) {
        const rawUrl = input instanceof Request ? input.url : String(input);
        try {
            return new URL(rawUrl, window.location.href);
        } catch {
            return null;
        }
    }

    window.fetch = async (input, init = {}) => {
        const url = apiUrl(input);
        const isApiRequest = url
            && url.origin === new URL(apiBase).origin
            && url.pathname.startsWith('/api/');
        const options = { ...init };
        if (isApiRequest && token) {
            const headers = new Headers(input instanceof Request ? input.headers : undefined);
            new Headers(init.headers || {}).forEach((value, name) => headers.set(name, value));
            headers.set('Authorization', `Bearer ${token}`);
            options.headers = headers;
        }
        const response = await originalFetch(input, options);
        if (isApiRequest && token && response.status === 401
            && !url.pathname.startsWith('/api/auth/')) {
            if (!expiredRedirectStarted) {
                expiredRedirectStarted = true;
                sessionStorage.removeItem(sessionKey);
                window.location.reload();
            }
        }
        return response;
    };

    function appLabel() {
        return config.appLabel || 'Staff App';
    }

    function renderLogin(message = '') {
        document.documentElement.classList.add('staff-auth-pending');
        const root = document.createElement('div');
        root.id = 'mr-auth-root';
        root.className = 'mr-auth-root';
        root.innerHTML = `
            <main class="mr-auth-card">
                <div class="mr-auth-brand">
                    <div class="mr-auth-mark" aria-hidden="true">MR</div>
                    <div>
                        <div class="mr-auth-brand-name">Mango Royal</div>
                        <div class="mr-auth-brand-app">${appLabel()}</div>
                    </div>
                </div>
                <h1>Welcome back</h1>
                <p class="mr-auth-subtitle">Sign in with your staff account to continue.</p>
                <form id="mr-auth-form">
                    <div class="mr-auth-field">
                        <label for="mr-auth-username">Username</label>
                        <input id="mr-auth-username" name="username" autocomplete="username" required>
                    </div>
                    <div class="mr-auth-field">
                        <label for="mr-auth-password">Password</label>
                        <input id="mr-auth-password" name="password" type="password" autocomplete="current-password" required>
                    </div>
                    <button class="mr-auth-submit" type="submit">Sign in</button>
                    <p class="mr-auth-error" id="mr-auth-error" role="alert">${message}</p>
                </form>
                <div class="mr-auth-demo">Use the role-specific demo account in the project README for this app.</div>
            </main>
        `;
        document.body.appendChild(root);
        root.querySelector('#mr-auth-username').focus();
        root.querySelector('#mr-auth-form').addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const button = form.querySelector('button[type="submit"]');
            const error = root.querySelector('#mr-auth-error');
            button.disabled = true;
            error.textContent = '';
            try {
                const response = await originalFetch(`${apiBase}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: form.elements.username.value,
                        password: form.elements.password.value,
                        appRole: config.role,
                    }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || `Sign-in failed (HTTP ${response.status}).`);
                if (result.user?.role !== config.role) {
                    throw new Error(`This account cannot access ${appLabel()}. Use the matching staff account.`);
                }
                token = result.token;
                sessionStorage.setItem(sessionKey, token);
                root.remove();
                await startApp(result.user);
            } catch (errorValue) {
                error.textContent = errorValue.message || 'Unable to sign in.';
                button.disabled = false;
            }
        });
    }

    function addLogout(user) {
        const existing = document.querySelector('#logout-btn, .nav-item.logout, [data-staff-logout]');
        if (existing) {
            const button = existing.cloneNode(true);
            existing.replaceWith(button);
            button.title = `Signed in as ${user.displayName}`;
            button.addEventListener('click', event => {
                event.preventDefault();
                void logout();
            });
            return;
        }

        const topbar = document.querySelector('.topbar-right');
        if (topbar) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mr-auth-logout';
            button.dataset.staffLogout = '';
            button.textContent = `Logout · ${user.displayName}`;
            button.addEventListener('click', () => void logout());
            topbar.appendChild(button);
        }
    }

    async function startApp(user) {
        document.documentElement.classList.remove('staff-auth-pending');
        document.documentElement.classList.add('staff-auth-ready');
        addLogout(user);
        const script = document.createElement('script');
        if (config.module) script.type = 'module';
        script.src = config.appScript;
        script.onerror = () => {
            document.documentElement.classList.remove('staff-auth-ready');
            renderLogin('The app could not be loaded. Check that the frontend files are being served.');
        };
        document.body.appendChild(script);
    }

    async function logout() {
        const activeToken = token;
        token = '';
        sessionStorage.removeItem(sessionKey);
        if (activeToken) {
            try {
                await originalFetch(`${apiBase}/api/auth/logout`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${activeToken}` },
                });
            } catch (error) {
                console.warn('Could not end the server session:', error.message);
            }
        }
        window.location.reload();
    }

    window.MangoRoyalAuth = { logout };

    async function initialize() {
        token = sessionStorage.getItem(sessionKey) || '';
        if (token) {
            try {
                const response = await originalFetch(`${apiBase}/api/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const result = await response.json().catch(() => ({}));
                if (response.ok && result.user?.role === config.role) {
                    await startApp(result.user);
                    return;
                }
                sessionStorage.removeItem(sessionKey);
                token = '';
                renderLogin(response.ok
                    ? `This app requires a ${config.role} account.`
                    : 'Your session expired. Please sign in again.');
            } catch {
                renderLogin('The sign-in service is unavailable. Check the backend and try again.');
            }
            return;
        }
        renderLogin();
    }

    void initialize();
})();
