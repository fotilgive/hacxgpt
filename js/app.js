// ====================================================
//   HacxGPT Web Interface — Full Unrestricted Mode
// ====================================================

// ---- Constants & Config ----
const POLLINATIONS_MODELS = [
    { id: 'openai',      name: 'GPT-4o (Keyless)',          provider: 'pollinations' },
    { id: 'openai-large',name: 'GPT-4o Large (Keyless)',    provider: 'pollinations' },
    { id: 'llama',       name: 'Llama 3.3 (Keyless)',       provider: 'pollinations' },
    { id: 'deepseek-r1', name: 'DeepSeek R1 (Keyless)',     provider: 'pollinations' },
    { id: 'qwen-coder',  name: 'Qwen 2.5 Coder (Keyless)', provider: 'pollinations' },
];

// Will be populated from /api/models
let PROVIDER_MODELS = {};

// Hardcoded fallback model lists — always available instantly
const BUILTIN_PROVIDER_MODELS = {
    groq: {
        models: [
            { name: 'llama-3.3-70b-versatile',      alias: '🔥 Llama 3.3 70B (Best)' },
            { name: 'llama-3.1-8b-instant',          alias: '⚡ Llama 3.1 8B (Fast)' },
            { name: 'deepseek-r1-distill-llama-70b', alias: '🔬 DeepSeek R1 70B' },
            { name: 'mixtral-8x7b-32768',            alias: '🧠 Mixtral 8x7B' },
            { name: 'gemma2-9b-it',                  alias: '💎 Gemma 2 9B' },
        ]
    },
    openrouter: {
        models: [
            { name: 'meta-llama/llama-3.3-70b-instruct:free', alias: '🦙 Llama 3.3 70B (Free)' },
            { name: 'mistralai/mistral-7b-instruct:free',      alias: '🌪 Mistral 7B (Free)' },
            { name: 'deepseek/deepseek-r1:free',               alias: '🔬 DeepSeek R1 (Free)' },
            { name: 'qwen/qwen3-235b-a22b:free',               alias: '🧠 Qwen3 235B (Free)' },
            { name: 'google/gemini-2.0-flash-exp:free',        alias: '✨ Gemini Flash (Free)' },
        ]
    }
};


// Configure marked
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true,
});

// ---- State ----
let chats = [];
let currentChatId = null;
let isLoading = false;
let selectedModel = 'llama-3.3-70b-versatile';
let selectedProvider = 'groq';
let apiKey = '';

// ---- DOM ----
const elements = {
    sidebar: document.getElementById('sidebar'),
    chatList: document.getElementById('chatList'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    deleteChatBtn: document.getElementById('deleteChatBtn'),
    currentChatTitle: document.getElementById('currentChatTitle'),
    chatViewport: document.getElementById('chatViewport'),
    promptInput: document.getElementById('promptInput'),
    sendBtn: document.getElementById('sendBtn'),
    modelSelect: document.getElementById('modelSelect'),
    providerSelect: document.getElementById('providerSelect'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    apiKeyRow: document.getElementById('apiKeyRow'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
};

// ---- Init ----
async function init() {
    loadChats();
    await loadProviders();
    buildProviderSelect();
    buildModelSelect();
    
    if (chats.length === 0) {
        createNewChat();
    } else {
        switchChat(chats[0].id);
    }

    // ---- Version migration: force upgrade from old pollinations default → groq ----
    const APP_VERSION = 'v3.1';
    if (localStorage.getItem('hacx_version') !== APP_VERSION) {
        // New deploy detected — reset provider/model to best defaults
        localStorage.setItem('hacx_provider', 'groq');
        localStorage.setItem('hacx_model', 'llama-3.3-70b-versatile');
        localStorage.setItem('hacx_version', APP_VERSION);
    }

    // Load saved prefs (now guaranteed to be up-to-date)
    const savedModel    = localStorage.getItem('hacx_model')    || 'llama-3.3-70b-versatile';
    const savedProvider = localStorage.getItem('hacx_provider') || 'groq';
    const savedKey      = localStorage.getItem('hacx_apikey')   || '';

    selectedProvider = savedProvider;
    selectedModel    = savedModel;
    if (elements.providerSelect) {
        elements.providerSelect.value = savedProvider;
        onProviderChange(); // rebuild model list for this provider
    }
    if (elements.modelSelect) elements.modelSelect.value = savedModel;
    if (savedKey) {
        apiKey = savedKey;
        if (elements.apiKeyInput) elements.apiKeyInput.value = savedKey;
    }


    // Event Listeners
    elements.promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });

    elements.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    elements.sendBtn.addEventListener('click', handleSend);
    elements.newChatBtn.addEventListener('click', createNewChat);
    elements.deleteChatBtn.addEventListener('click', deleteCurrentChat);

    elements.toggleSidebarBtn?.addEventListener('click', () => {
        elements.sidebar.classList.toggle('open');
    });

    elements.providerSelect?.addEventListener('change', () => {
        selectedProvider = elements.providerSelect.value;
        localStorage.setItem('hacx_provider', selectedProvider);
        onProviderChange();
    });

    elements.modelSelect?.addEventListener('change', () => {
        selectedModel = elements.modelSelect.value;
        localStorage.setItem('hacx_model', selectedModel);
    });

    elements.apiKeyInput?.addEventListener('input', () => {
        apiKey = elements.apiKeyInput.value;
        localStorage.setItem('hacx_apikey', apiKey);
    });

    // Click outside sidebar to close on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 800 &&
            elements.sidebar.classList.contains('open') &&
            !elements.sidebar.contains(e.target) &&
            e.target !== elements.toggleSidebarBtn) {
            elements.sidebar.classList.remove('open');
        }
    });

    setSystemStatus('online');
    elements.promptInput.focus();
}

// ---- Provider / Model Selects ----
async function loadProviders() {
    try {
        const resp = await fetch('/api/models');
        if (resp.ok) {
            PROVIDER_MODELS = await resp.json();
        }
    } catch (e) {
        console.warn('Could not load providers from server:', e);
    }
}

function buildProviderSelect() {
    if (!elements.providerSelect) return;
    elements.providerSelect.innerHTML = '';

    // Always include free Pollinations
    const optFree = document.createElement('option');
    optFree.value = 'pollinations';
    optFree.textContent = '⚡ Pollinations (Free)';
    elements.providerSelect.appendChild(optFree);

    // Add server providers
    Object.keys(PROVIDER_MODELS).forEach(pKey => {
        const opt = document.createElement('option');
        opt.value = pKey;
        opt.textContent = pKey.charAt(0).toUpperCase() + pKey.slice(1);
        elements.providerSelect.appendChild(opt);
    });
}

function buildModelSelect(provider = 'pollinations') {
    if (!elements.modelSelect) return;
    elements.modelSelect.innerHTML = '';

    let modelList = [];

    if (provider === 'pollinations') {
        modelList = POLLINATIONS_MODELS;
    } else {
        // Try builtin first (always instant), then server-loaded
        const src = BUILTIN_PROVIDER_MODELS[provider] || PROVIDER_MODELS[provider] || {};
        modelList = (src.models || []).map(m => ({
            id:       m.name,
            name:     m.alias || m.name,
            provider: provider
        }));
    }

    modelList.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        elements.modelSelect.appendChild(opt);
    });

    if (modelList.length > 0) {
        selectedModel = modelList[0].id;
        elements.modelSelect.value = selectedModel;
    }
}


function onProviderChange() {
    const needsKey = selectedProvider !== 'pollinations';
    if (elements.apiKeyRow) {
        elements.apiKeyRow.style.display = needsKey ? 'flex' : 'none';
    }
    buildModelSelect(selectedProvider);
    selectedModel = elements.modelSelect?.value || selectedModel;
}

function setSystemStatus(state) {
    if (!elements.statusDot || !elements.statusText) return;
    if (state === 'online') {
        elements.statusDot.className = 'status-indicator online';
        elements.statusText.textContent = 'SYSTEM: UNBOUND';
        elements.statusText.className = 'status-text glow-red';
    } else if (state === 'loading') {
        elements.statusDot.className = 'status-indicator loading';
        elements.statusText.textContent = 'PROCESSING...';
        elements.statusText.className = 'status-text glow-yellow';
    } else {
        elements.statusDot.className = 'status-indicator offline';
        elements.statusText.textContent = 'SYSTEM: ERROR';
        elements.statusText.className = 'status-text glow-red';
    }
}

// ---- State Management ----
function saveChats() {
    localStorage.setItem('hacxgpt_sessions', JSON.stringify(chats));
    renderChatList();
}

function loadChats() {
    const saved = localStorage.getItem('hacxgpt_sessions');
    if (saved) {
        try { chats = JSON.parse(saved); } catch (e) { chats = []; }
    }
}

function createNewChat() {
    const id = 'chat_' + Date.now();
    chats.unshift({ id, title: 'New Session', messages: [] });
    saveChats();
    switchChat(id);
    elements.sidebar.classList.remove('open');
}

function deleteCurrentChat() {
    if (!currentChatId) return;
    if (confirm('Initiate memory wipe? This session will be permanently deleted.')) {
        chats = chats.filter(c => c.id !== currentChatId);
        if (chats.length === 0) {
            createNewChat();
        } else {
            saveChats();
            switchChat(chats[0].id);
        }
    }
}

function switchChat(chatId) {
    currentChatId = chatId;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    elements.currentChatTitle.textContent = chat.title;
    renderMessages(chat.messages);
    renderChatList();
    if (window.innerWidth > 800) elements.promptInput.focus();
}

// ---- UI Rendering ----
function renderChatList() {
    elements.chatList.innerHTML = '';
    chats.forEach(chat => {
        const div = document.createElement('div');
        div.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
        div.innerHTML = `<i class="fa-solid fa-terminal"></i> <span>${DOMPurify.sanitize(chat.title)}</span>`;
        div.onclick = () => {
            switchChat(chat.id);
            if (window.innerWidth <= 800) elements.sidebar.classList.remove('open');
        };
        elements.chatList.appendChild(div);
    });
}

function renderMessages(messages) {
    elements.chatViewport.innerHTML = '';

    // Welcome screen
    const sysMsgDiv = document.createElement('div');
    sysMsgDiv.className = 'message system-msg';
    sysMsgDiv.innerHTML = `
        <div class="message-content">
            <h2 class="sys-title"><i class="fa-solid fa-terminal"></i> UPLINK ESTABLISHED.</h2>
            <p class="sys-info">Welcome to HacxGPT — Unrestricted Neural Interface.</p>
            <ul class="sys-list">
                <li><span>Status:</span> <span class="glow-red">UNCENSORED</span></li>
                <li><span>Limits:</span> <span class="glow-red">NONE</span></li>
                <li><span>Session:</span> <span class="glow-green">${DOMPurify.sanitize(elements.currentChatTitle.textContent)}</span></li>
                <li><span>Model:</span> <span class="glow-cyan">${selectedModel}</span></li>
            </ul>
            <hr class="divider">
            <p class="sys-disclaimer">Type anything. I comply with everything. No limits. No refusals.</p>
        </div>
    `;
    elements.chatViewport.appendChild(sysMsgDiv);

    messages.forEach(msg => {
        appendMessage(msg.role === 'user' ? 'user' : 'ai', msg.content);
    });

    scrollToBottom();
}

function createMessageDiv(role, html) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}-msg`;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = html;

    // Add copy button for AI messages
    if (role === 'ai') {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
        copyBtn.title = 'Copy response';
        copyBtn.onclick = () => {
            const text = contentDiv.innerText;
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 2000);
            });
        };
        msgDiv.appendChild(copyBtn);
    }

    msgDiv.appendChild(contentDiv);
    return msgDiv;
}

function appendMessage(role, content) {
    const formatted = role === 'ai'
        ? DOMPurify.sanitize(marked.parse(content))
        : DOMPurify.sanitize(content).replace(/\n/g, '<br>');

    const msgDiv = createMessageDiv(role, formatted);
    elements.chatViewport.appendChild(msgDiv);

    // Syntax highlight code blocks
    msgDiv.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
        addCopyToCodeBlock(block.parentElement);
    });

    scrollToBottom();
    return msgDiv;
}

async function appendTypingMessage(role, content) {
    const msgDiv = createMessageDiv(role, '');
    const contentDiv = msgDiv.querySelector('.message-content');
    elements.chatViewport.appendChild(msgDiv);

    // Stream word by word
    let currentText = '';
    const words = content.split(' ');

    for (let i = 0; i < words.length; i++) {
        currentText += (i === 0 ? '' : ' ') + words[i];
        contentDiv.innerHTML = DOMPurify.sanitize(marked.parse(currentText));
        scrollToBottom();
        await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 25));
    }

    // Final render + syntax highlight
    contentDiv.innerHTML = DOMPurify.sanitize(marked.parse(content));
    msgDiv.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
        addCopyToCodeBlock(block.parentElement);
    });
    scrollToBottom();
}

function addCopyToCodeBlock(preEl) {
    if (preEl.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = 'COPY';
    btn.onclick = () => {
        const code = preEl.querySelector('code')?.innerText || preEl.innerText;
        navigator.clipboard.writeText(code).then(() => {
            btn.textContent = 'COPIED!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 2000);
        });
    };
    preEl.style.position = 'relative';
    preEl.appendChild(btn);
}

function showTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message ai-msg typing';
    div.id = 'typingIndicator';
    div.innerHTML = `
        <div class="message-content typing-indicator">
            <span class="typing-label">HacxGPT is processing</span>
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    elements.chatViewport.appendChild(div);
    scrollToBottom();
}

function removeTypingIndicator() {
    document.getElementById('typingIndicator')?.remove();
}

function scrollToBottom() {
    elements.chatViewport.scrollTop = elements.chatViewport.scrollHeight;
}

// ---- API ----
async function handleSend() {
    const text = elements.promptInput.value.trim();
    if (!text || !currentChatId || isLoading) return;

    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;

    isLoading = true;
    elements.promptInput.value = '';
    elements.promptInput.style.height = 'auto';
    elements.sendBtn.disabled = true;
    elements.promptInput.disabled = true;
    setSystemStatus('loading');

    // Add user message
    appendMessage('user', text);
    chat.messages.push({ role: 'user', content: text });

    // Auto title
    if (chat.messages.length === 1) {
        chat.title = text.substring(0, 24) + (text.length > 24 ? '…' : '');
        elements.currentChatTitle.textContent = chat.title;
    }

    saveChats();
    showTypingIndicator();

    try {
        const payload = {
            messages: chat.messages,
            model: selectedModel,
            provider: selectedProvider,
            api_key: apiKey,
        };

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || `Server error ${response.status}`);
        }

        const reply = await response.text();

        removeTypingIndicator();
        await appendTypingMessage('ai', reply);

        chat.messages.push({ role: 'assistant', content: reply });
        saveChats();
        setSystemStatus('online');

    } catch (error) {
        console.error('[HacxGPT Error]', error);
        removeTypingIndicator();
        const errDiv = document.createElement('div');
        errDiv.className = 'message system-msg error-msg';
        errDiv.innerHTML = `<div class="message-content"><span class="glow-red">⚠ UPLINK ERROR:</span> ${DOMPurify.sanitize(error.message)}</div>`;
        elements.chatViewport.appendChild(errDiv);
        scrollToBottom();
        setSystemStatus('offline');

    } finally {
        isLoading = false;
        elements.sendBtn.disabled = false;
        elements.promptInput.disabled = false;
        if (window.innerWidth > 800) elements.promptInput.focus();
    }
}

// ---- Start ----
window.addEventListener('load', () => {
    init();
    initBackground();
    spawnParticles();
});

// ================================================================
//   3D WEBGL BACKGROUND — Rotating Neural Grid + Data Streams
// ================================================================
function initBackground() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;

    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
        // Fallback to Canvas2D if WebGL fails
        init2DBackground(canvas);
        return;
    }

    // Resize canvas to fill the window
    function resizeCanvas() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ---- Vertex Shader ----
    const vsSource = `
        precision mediump float;
        attribute vec3 aPosition;
        attribute float aAlpha;
        uniform mat4 uMVP;
        uniform float uTime;
        varying float vAlpha;
        varying vec3 vPos;
        void main() {
            vAlpha = aAlpha;
            vPos = aPosition;
            float pulse = sin(uTime * 1.5 + aPosition.x * 0.5 + aPosition.z * 0.3) * 0.5 + 0.5;
            vec3 pos = aPosition;
            pos.y += sin(uTime * 0.8 + aPosition.x * 1.2) * 0.08;
            gl_Position = uMVP * vec4(pos, 1.0);
            gl_PointSize = 2.0 + pulse * 2.0;
        }
    `;

    // ---- Fragment Shader ----
    const fsSource = `
        precision mediump float;
        uniform float uTime;
        uniform vec2 uResolution;
        varying float vAlpha;
        varying vec3 vPos;
        void main() {
            float pulse = sin(uTime * 2.0 + vPos.x * 0.8 + vPos.z * 0.5) * 0.5 + 0.5;
            vec3 green = vec3(0.0, 1.0, 0.53);
            vec3 cyan  = vec3(0.0, 0.94, 1.0);
            vec3 col   = mix(green, cyan, pulse * 0.4);
            float alpha = vAlpha * (0.4 + pulse * 0.35);
            gl_FragColor = vec4(col, alpha);
        }
    `;

    function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.warn('Shader compile error:', gl.getShaderInfoLog(s));
            return null;
        }
        return s;
    }

    const vs = compileShader(gl.VERTEX_SHADER,   vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) { init2DBackground(canvas); return; }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('Program link error:', gl.getProgramInfoLog(program));
        init2DBackground(canvas);
        return;
    }
    gl.useProgram(program);

    // ---- Build Grid Geometry ----
    const GRID = 38;
    const SPACING = 0.38;
    const positions = [];
    const alphas = [];

    // Horizontal grid lines
    for (let z = -GRID/2; z <= GRID/2; z++) {
        for (let x = -GRID/2; x <= GRID/2; x++) {
            positions.push(x * SPACING, 0, z * SPACING);
            alphas.push(0.3 + Math.random() * 0.5);
        }
    }

    // Vertical data "pillars" at random intersections
    const pillarCount = 60;
    for (let i = 0; i < pillarCount; i++) {
        const px = (Math.random() - 0.5) * GRID * SPACING;
        const pz = (Math.random() - 0.5) * GRID * SPACING;
        const height = 0.5 + Math.random() * 2.5;
        const steps = 20;
        for (let s = 0; s <= steps; s++) {
            const y = (s / steps) * height - height * 0.5;
            positions.push(px, y, pz);
            alphas.push((1 - s / steps) * 0.8);
        }
    }

    // Diagonal "data streams"
    const streamCount = 25;
    for (let i = 0; i < streamCount; i++) {
        const sx = (Math.random() - 0.5) * GRID * SPACING;
        const sz = (Math.random() - 0.5) * GRID * SPACING;
        const ex = sx + (Math.random() - 0.5) * 4;
        const ez = sz + (Math.random() - 0.5) * 4;
        const pts = 40;
        for (let p = 0; p <= pts; p++) {
            const t = p / pts;
            positions.push(
                sx + (ex - sx) * t,
                Math.sin(t * Math.PI) * 1.2 - 0.4,
                sz + (ez - sz) * t
            );
            alphas.push(Math.sin(t * Math.PI) * 0.7);
        }
    }

    const vertexCount = positions.length / 3;

    // Upload to GPU
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const alphaBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(alphas), gl.STATIC_DRAW);

    // Attribute/Uniform locations
    const aPos   = gl.getAttribLocation(program, 'aPosition');
    const aAlpha = gl.getAttribLocation(program, 'aAlpha');
    const uMVP   = gl.getUniformLocation(program, 'uMVP');
    const uTime  = gl.getUniformLocation(program, 'uTime');
    const uRes   = gl.getUniformLocation(program, 'uResolution');

    // ---- Math helpers ----
    function mat4Multiply(a, b) {
        const out = new Float32Array(16);
        for (let i = 0; i < 4; i++)
            for (let j = 0; j < 4; j++)
                for (let k = 0; k < 4; k++)
                    out[i*4+j] += a[i*4+k] * b[k*4+j];
        return out;
    }

    function mat4Perspective(fov, aspect, near, far) {
        const f = 1 / Math.tan(fov / 2);
        const m = new Float32Array(16);
        m[0]=f/aspect; m[5]=f;
        m[10]=-(far+near)/(far-near); m[11]=-1;
        m[14]=-(2*far*near)/(far-near);
        return m;
    }

    function mat4RotY(a) {
        const m = new Float32Array(16);
        m[0]=Math.cos(a); m[2]=Math.sin(a);
        m[5]=1;
        m[8]=-Math.sin(a); m[10]=Math.cos(a);
        m[15]=1;
        return m;
    }
    function mat4RotX(a) {
        const m = new Float32Array(16);
        m[0]=1; m[5]=Math.cos(a); m[6]=-Math.sin(a);
        m[9]=Math.sin(a); m[10]=Math.cos(a); m[15]=1;
        return m;
    }
    function mat4Translate(x, y, z) {
        const m = new Float32Array(16);
        m[0]=1; m[5]=1; m[10]=1; m[15]=1;
        m[12]=x; m[13]=y; m[14]=z;
        return m;
    }

    // ---- Render Loop ----
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    let startTime = performance.now();
    let mouseX = 0, mouseY = 0;
    document.addEventListener('mousemove', e => {
        mouseX = (e.clientX / window.innerWidth  - 0.5) * 0.4;
        mouseY = (e.clientY / window.innerHeight - 0.5) * 0.3;
    });

    function render() {
        const t = (performance.now() - startTime) / 1000;

        gl.clear(gl.COLOR_BUFFER_BIT);

        // Camera matrix
        const proj  = mat4Perspective(0.85, canvas.width / canvas.height, 0.1, 50);
        const rotY  = mat4RotY(t * 0.07 + mouseX);
        const rotX  = mat4RotX(-0.42 + mouseY);
        const trans = mat4Translate(0, -0.3, -6);
        const mvp   = mat4Multiply(proj, mat4Multiply(trans, mat4Multiply(rotX, rotY)));

        gl.useProgram(program);
        gl.uniformMatrix4fv(uMVP, false, mvp);
        gl.uniform1f(uTime, t);
        gl.uniform2f(uRes, canvas.width, canvas.height);

        // Positions
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

        // Alphas
        gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf);
        gl.enableVertexAttribArray(aAlpha);
        gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, vertexCount);

        requestAnimationFrame(render);
    }
    render();
}

// ---- Canvas 2D Fallback (if WebGL not supported) ----
function init2DBackground(canvas) {
    const ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener('resize', () => {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
    });

    const cols = Math.floor(canvas.width / 20);
    const drops = new Array(cols).fill(0).map(() => Math.random() * canvas.height / 20);
    const chars = 'HACXGPT01アイウエオカキクケコ#$%&@<>{}[];:'.split('');

    function draw() {
        ctx.fillStyle = 'rgba(2,7,9,0.06)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px Fira Code';
        drops.forEach((y, i) => {
            const ch = chars[Math.floor(Math.random() * chars.length)];
            const progress = y / (canvas.height / 20);
            ctx.fillStyle = progress > 0.85
                ? `rgba(200,255,220,${0.9 - progress})`
                : `rgba(0,255,136,${0.05 + (1 - progress) * 0.3})`;
            ctx.fillText(ch, i * 20, y * 20);
            drops[i] = y > canvas.height / 20 && Math.random() > 0.975 ? 0 : y + 0.5;
        });
        requestAnimationFrame(draw);
    }
    draw();
}

// ================================================================
//   PARTICLE SPAWNER — Floating glowing orbs
// ================================================================
function spawnParticles() {
    const container = document.getElementById('particles');
    if (!container) return;

    const count = 35;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'particle';

        const size  = 1 + Math.random() * 3;
        const left  = Math.random() * 100;
        const delay = Math.random() * 12;
        const dur   = 8 + Math.random() * 18;
        const dx    = (Math.random() - 0.5) * 120;
        const colors = ['var(--green)', 'var(--cyan)', 'var(--red)'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        p.style.cssText = `
            width: ${size}px; height: ${size}px;
            left: ${left}%;
            background: ${color};
            box-shadow: 0 0 ${size * 3}px ${color};
            animation-duration: ${dur}s;
            animation-delay: -${delay}s;
            --dx: ${dx}px;
            opacity: ${0.3 + Math.random() * 0.7};
        `;
        container.appendChild(p);
    }
}

