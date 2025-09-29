// ================= LOGIN =================
function initLogin() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;
    loginForm.addEventListener('submit', handleLogin);
}

function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    const users = {
        farmer1: "pass123",
        farmer2: "pass456"
    };

    const errMsg = document.getElementById('error-message');
    if (errMsg) errMsg.classList.remove('show');

    if (users[username] && users[username] === password) {
        localStorage.setItem('agrosmartLoggedIn', 'true');
        localStorage.setItem('agrosmartUsername', username);
        window.location.href = 'dashboard.html'; // redirect to dashboard
    } else {
        if (errMsg) {
            errMsg.textContent = 'Invalid username or password';
            errMsg.classList.add('show');
        }
    }
}

// Check if user already logged in
function checkLogin() {
    if (localStorage.getItem('agrosmartLoggedIn') === 'true' && window.location.pathname.includes('login.html')) {
        window.location.href = 'dashboard.html';
    }
}

// ================= THINGSPEAK CONFIG =================
const THINGSPEAK_CONFIG = {
    CROP_SELECTION: {
        CHANNEL_ID: '3093271',
        WRITE_API_KEY: 'B1SJ39GTBKL71X04',
        READ_API_KEY: '5GM5VXXHSC742P3Q'
    },
    CROP_CHANNELS: {
        1: { CHANNEL_ID: '3093261', WRITE_API_KEY: '1A2I4ILM7YD40L4G', READ_API_KEY: '2V44UCGHTIQZJONV' },
        2: { CHANNEL_ID: '3093263', WRITE_API_KEY: 'RR43STU7I16A4G8R', READ_API_KEY: 'PF8IWMWUTC67T5TU' },
        3: { CHANNEL_ID: '3093265', WRITE_API_KEY: 'LPRRTI19Q9C60S7I', READ_API_KEY: 'Y1HDTGHJ1R0PSRDS' }
    }
};

// ================= GLOBALS =================
let currentCrop = null;
let dataInterval = null;
let thresholdChart, soilMoistureChart, waterLevelChart, pumpStatusChart;

// ================= UTILS =================
function showStatusMessage(msg, type = 'info') {
    const c = document.getElementById('status-messages');
    if (!c) return;
    const d = document.createElement('div');
    d.className = `status-message ${type}`;
    d.textContent = msg;
    c.appendChild(d);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 5000);
}

function formatDateTime(date) {
    return date.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function updateElement(id, val, suffix = '') {
    const e = document.getElementById(id);
    if (e) e.textContent = val + suffix;
}

// ================= DASHBOARD INIT =================
function initDashboard() {
    initCharts();
    initCropSelection();
}

// ================= CROP SELECTION =================
function initCropSelection() {
    document.querySelectorAll('.crop-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cropId = parseInt(btn.dataset.crop);
            const cropName = btn.dataset.name;
            selectCrop(cropId, cropName, btn);
        });
    });
}

async function selectCrop(cropId, cropName, btnElement) {
    try {
        document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('active'));
        btnElement.classList.add('active');

        const statusDiv = document.getElementById('crop-status');
        statusDiv.textContent = `Sending crop selection (${cropName})...`;
        statusDiv.className = 'crop-status info';

        const success = await sendCropSelection(cropId);

        if (success) {
            currentCrop = cropId;
            statusDiv.textContent = `✅ ${cropName} selected!`;
            statusDiv.className = 'crop-status success';

            document.getElementById('selected-crop-info').textContent = `Live sensor data for ${cropName}`;
            document.getElementById('dataGrid').style.display = 'grid';

            await loadHistoricalData();
            startDataFetching();
            showStatusMessage(`Crop changed to ${cropName}. ESP32 adjusting parameters.`, 'success');
        } else {
            statusDiv.textContent = '❌ Failed to send crop selection. Try again.';
            statusDiv.className = 'crop-status error';
            btnElement.classList.remove('active');
        }
    } catch (err) {
        console.error(err);
        showStatusMessage('Error communicating with server.', 'error');
        btnElement.classList.remove('active');
    }
}

async function sendCropSelection(cropId) {
    const url = `https://api.thingspeak.com/update?api_key=${THINGSPEAK_CONFIG.CROP_SELECTION.WRITE_API_KEY}&field1=${cropId}`;
    try {
        const res = await fetch(url);
        const r = await res.text();
        return r && r !== '0';
    } catch (err) {
        console.error(err);
        return false;
    }
}

// ================= CHARTS =================
function initCharts() {
    const opts = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: { type: 'time', time: { unit: 'minute', tooltipFormat: 'MMM d, yyyy, HH:mm:ss' } },
            y: { beginAtZero: true }
        }
    };

    thresholdChart = new Chart(document.getElementById('thresholdChart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Max Threshold', data: [], borderColor: 'blue', fill: false }] },
        options: opts
    });

    soilMoistureChart = new Chart(document.getElementById('soilMoistureChart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Soil Moisture', data: [], borderColor: 'green', fill: false }] },
        options: opts
    });

    waterLevelChart = new Chart(document.getElementById('waterLevelChart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Water Level (cm)', data: [], borderColor: 'aqua', fill: false }] },
        options: opts
    });

    pumpStatusChart = new Chart(document.getElementById('pumpStatusChart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Pump Status', data: [], borderColor: 'red', fill: false }] },
        options: opts
    });
}

function updateCharts(data) {
    const t = new Date(data.created_at);
    const threshold = parseFloat(data.field1 || 0);
    const soil = parseFloat(data.field2 || 0);
    const pump = data.field3 === '1' ? 1 : 0;
    const water = parseFloat(data.field4 || 0);

    function addData(chart, label, value) {
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(value);
        if (chart.data.labels.length > 20) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update();
    }

    addData(thresholdChart, t, threshold);
    addData(soilMoistureChart, t, soil);
    addData(waterLevelChart, t, water);
    addData(pumpStatusChart, t, pump);
}

// ================= SENSOR DATA =================
function startDataFetching() {
    if (dataInterval) clearInterval(dataInterval);
    fetchSensorData();
    dataInterval = setInterval(fetchSensorData, 15000);
}

async function fetchSensorData() {
    if (!currentCrop) return;

    const cropConfig = THINGSPEAK_CONFIG.CROP_CHANNELS[currentCrop];
    if (!cropConfig) {
        console.error('No config for current crop', currentCrop);
        return;
    }

    try {
        // Remove &results=1 for last feed
        const url = `https://api.thingspeak.com/channels/${cropConfig.CHANNEL_ID}/feeds/last.json?api_key=${cropConfig.READ_API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        const data = await res.json();
        console.log('Fetched sensor data:', data);

        // Parse pump as number
        if (data.field3 !== undefined) data.field3 = parseInt(data.field3);

        updateSensorDisplay(data);

    } catch (err) {
        console.error(err);
        showStatusMessage('Failed to fetch sensor data.', 'error');
        updateElement('soilMoisture', '--');
        updateElement('pumpStatus', 'Error');
        updateElement('waterLevel', '--', 'cm');
        updateElement('maxThreshold', '--');
    }
}
function updateSensorDisplay(data) {
    if (!data) return;

    const soil = data.field2 ?? '--';
    const water = data.field4 ?? '--';
    const pumpStatus = data.field3 === '1' ? '🟢 ON' : '🔴 OFF';
    const threshold = data.field1 ?? '--';

    updateElement('soilMoisture', soil);
    updateElement('waterLevel', water, 'cm');
    updateElement('pumpStatus', pumpStatus);
    updateElement('maxThreshold', threshold);

    if (data.created_at) {
        document.getElementById('lastUpdated').textContent = formatDateTime(new Date(data.created_at));
    }

    const chartData = {
        created_at: data.created_at,
        field1: parseFloat(data.field1) || 0,
        field2: parseFloat(data.field2) || 0,
        field3: data.field3 === '1' ? 1 : 0,
        field4: parseFloat(data.field4) || 0
    };
    updateCharts(chartData);
}

// ================= HISTORICAL DATA =================
async function loadHistoricalData() {
    if (!currentCrop) return;
    const cropConfig = THINGSPEAK_CONFIG.CROP_CHANNELS[currentCrop];
    try {
        const url = `https://api.thingspeak.com/channels/${cropConfig.CHANNEL_ID}/feeds.json?api_key=${cropConfig.READ_API_KEY}&results=20`;
        const res = await fetch(url);
        const data = await res.json();

        // Clear previous chart data
        [thresholdChart, soilMoistureChart, waterLevelChart, pumpStatusChart].forEach(c => {
            c.data.labels = [];
            c.data.datasets[0].data = [];
            c.update();
        });

        // Update charts with proper parsing
        data.feeds.forEach(feed => {
            const chartData = {
                created_at: feed.created_at,
                field1: parseFloat(feed.field1) || 0,
                field2: parseFloat(feed.field2) || 0,
                field3: parseInt(feed.field3) === 1 ? 1 : 0,
                field4: parseFloat(feed.field4) || 0
            };
            updateCharts(chartData);
        });

    } catch (err) {
        console.error("Failed to load historical data:", err);
    }
}

// ================= PAGE INIT =================
document.addEventListener('DOMContentLoaded', () => {
    // Login init
    checkLogin();
    initLogin();

    // Dashboard init only on dashboard page
    if (window.location.pathname.includes('dashboard.html')) {
        initDashboard();
        window.addEventListener('beforeunload', () => { if (dataInterval) clearInterval(dataInterval); });
    }
});
