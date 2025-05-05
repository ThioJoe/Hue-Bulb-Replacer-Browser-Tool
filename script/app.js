// --- Configuration ---
const SESSION_STORAGE_IP_KEY = 'hueReplacerBridgeIp';
const SESSION_STORAGE_API_KEY = 'hueReplacerApiUser';

// --- DOM Elements ---
const bridgeIpInput = document.getElementById('bridgeIp');
const apiUserInput = document.getElementById('apiUser');
const fetchLightsBtn = document.getElementById('fetchLightsBtn');
const oldLightSelect = document.getElementById('oldLightSelect');
const newLightSelect = document.getElementById('newLightSelect');
const startReplacementBtn = document.getElementById('startReplacementBtn');
const logOutput = document.getElementById('logOutput');
const step1Div = document.getElementById('step1');
const step2Div = document.getElementById('step2');
const step3Div = document.getElementById('step3');
const step1Error = document.getElementById('step1Error');
const step2Error = document.getElementById('step2Error');
const confirmationDiv = document.getElementById('confirmation');
const confirmOldName = document.getElementById('confirmOldName');
const confirmOldId = document.getElementById('confirmOldId');
const confirmNewName = document.getElementById('confirmNewName');
const confirmNewId = document.getElementById('confirmNewId');
const alternateOptionsDiv = document.getElementById('debugOptions'); // Debug container
const altRenameCheck = document.getElementById('debugRenameCheck'); // Debug checkbox
const renameWarningDefault = document.getElementById('renameWarningDefault');
const renameWarningAlt = document.getElementById('renameWarningDebug');

// --- State Variables ---
let bridgeIp = '';
let apiUser = '';
let apiV1BaseUrl = '';
let apiV2BaseUrl = '';
/** @type {Record<string, any> | null} */
// Using 'any' as V1 light object structure is complex
let allV1Lights = null;
/** @type {Record<string, string> | null} */
let v1ToV2IdMap = null; // Map V1 numeric ID (string) to V2 GUID (string)
/** @type {string | null} */
let selectedOldLightV1Id = null;
/** @type {string | null} */
let selectedNewLightV1Id = null;

// --- Utility Functions ---

/**
         * Logs a message to the progress box.
         * @param {string} message - The message to log.
         * @param {'info' | 'success' | 'warning' | 'error'} type - The type of message.
         */
function log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    entry
        .classList
        .add('log-entry', `log-${type}`);
    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight; // Auto-scroll to bottom
    if (type === 'error') 
        console.error(message);
    if (type === 'warning') 
        console.warn(message);
    }

/** Clears the log output. */
function clearLog() {
    logOutput.innerHTML = '';
}

/**
         * Makes an API request to the Hue Bridge.
         * Handles both V1 and V2 style API calls based on the URL structure.
         * @param {string} url - The FULL API URL endpoint.
         * @param {string} method - HTTP method ('GET', 'PUT', 'POST', 'DELETE').
         * @param {object | null} [body=null] - The request body for PUT/POST.
         * @param {string} [apiUsername=null] - The API username for V2 'hue-application-key' header.
         * @param {boolean} [forceV2Header=false] - Force adding the V2 header even for GET requests (needed for /resource).
         * @returns {Promise<any>} - A promise that resolves with the JSON response or rejects on error.
         */
async function apiRequest(url, method, body = null, apiUsername = null, forceV2Header = false) {
    const options = {
        method: method,
        headers: {}
    };

    // Add V2 header if it's a V2 URL and either not GET, or forceV2Header is true
    if (url.includes('/clip/v2/') && apiUsername && (method !== 'GET' || forceV2Header)) {
        options.headers['hue-application-key'] = apiUsername;
    }

    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    try {
        // Ensure HTTPS is used for all bridge communication
        if (!url.startsWith('https://')) {
            url = url.replace(/^http:/, 'https:');
            log(`Corrected URL to use HTTPS: ${url}`, 'warning');
        }

        const response = await fetch(url, options);

        // Specific V2 error handling
        if (response.status === 403 && url.includes('/clip/v2/')) {
            throw new Error(`API V2 Forbidden (403): Check if API Username '${apiUsername || '?'}' is valid and whitelisted.`);
        }
        if (response.status === 404 && url.includes('/clip/v2/')) {
            throw new Error(`API V2 Not Found (404): Endpoint ${url} does not exist.`);
        }

        // General error handling
        if (!response.ok) {
            let errorDetails = `HTTP error! Status: ${response.status}`;
            let errorData = null;
            try {
                errorData = await response.json();
                // Try parsing V1 error format
                if (Array.isArray(errorData) && errorData[0]
                    ?.error
                        ?.description) {
                    errorDetails += ` - V1 Error: ${errorData[0].error.description}`;
                    // Try parsing V2 error format
                } else if (errorData
                    ?.errors && Array.isArray(errorData.errors) && errorData.errors[0]
                        ?.description) {
                    errorDetails += ` - V2 Error: ${errorData.errors[0].description}`;
                } else {
                    // Attempt to get text if JSON parsing failed or format is unknown
                    try {
                        errorDetails += ` - ${await response.text()}`;
                    } catch (textErr) {}
                }
            } catch (e) {
                // Fallback if JSON parsing fails completely
                try {
                    errorDetails += ` - ${await response.text()}`;
                } catch (textErr) {}
            }
            throw new Error(errorDetails);
        }

        // If response is OK, attempt to parse JSON Handle cases where response might be
        // OK but have no content (e.g., successful PUT often returns array)
        const contentType = response
            .headers
            .get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            // Log potential non-blocking warnings from the API response
            if (Array.isArray(data) && data[0]
                ?.error) {
                log(`API V1 Warning: ${data[0].error.description}`, 'warning');
            }
            if (data
                ?.errors && Array.isArray(data.errors) && data.errors.length > 0) {
                log(`API V2 Warning: ${data.errors[0].description}`, 'warning');
            }
            return data;
        } else {
            // Handle non-JSON successful responses if necessary, otherwise return null or
            // success indicator
            log(`Request successful (${response.status}), but response was not JSON.`, 'info');
            return {success: true, status: response.status}; // Indicate success
        }

    } catch (error) {
        console.error(`API Request Failed: ${method} ${url}`, error);
        // Check for network errors (e.g., connection refused, DNS error, CORS,
        // certificate issue)
        if (error instanceof TypeError && error.message.includes('fetch')) {
            // Check if it's likely a certificate error specifically for HTTPS
            if (url.startsWith('https://')) {
                throw new Error(`Network/Certificate Error: Could not connect securely to bridge at ${url}. Did you trust the certificate in your browser (Step 3 in instructions)? Also check IP/Username and network connection.`);
            } else {
                throw new Error(`Network Error: Could not connect to bridge at ${url}. Check IP/Username and network connection.`);
            }
        }
        // Re-throw other errors (like the ones created above)
        throw error;
    }
}

/** Pauses execution. @param {number} ms - Milliseconds. @returns {Promise<void>} */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Updates the confirmation message based on selections and alt rename checkbox */
function updateConfirmation() {
    selectedOldLightV1Id = oldLightSelect.value;
    selectedNewLightV1Id = newLightSelect.value;
    step2Error.textContent = ''; // Clear errors

    if (selectedOldLightV1Id && selectedNewLightV1Id) {
        if (selectedOldLightV1Id === selectedNewLightV1Id) {
            step2Error.textContent = 'Old and New bulb cannot be the same.';
            confirmationDiv
                .classList
                .add('hidden');
            startReplacementBtn.disabled = true;
        } else {
            // Update confirmation text
            confirmOldId.textContent = selectedOldLightV1Id;
            confirmOldName.textContent = allV1Lights[selectedOldLightV1Id]
                ?.name || 'Unknown';
            confirmNewId.textContent = selectedNewLightV1Id;
            confirmNewName.textContent = allV1Lights[selectedNewLightV1Id]
                ?.name || 'Unknown';

            // Toggle rename warning based on alt rename checkbox state
            const useAlternateRename = altRenameCheck.checked;
            renameWarningDefault
                .classList
                .toggle('hidden', useAlternateRename);
            renameWarningAlt
                .classList
                .toggle('hidden', !useAlternateRename);

            confirmationDiv
                .classList
                .remove('hidden');
            startReplacementBtn.disabled = false;
        }
    } else {
        confirmationDiv
            .classList
            .add('hidden');
        startReplacementBtn.disabled = true;
    }
}

// --- Event Listeners --- Load saved values and set up listeners on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Show alt option
    alternateOptionsDiv.style.display = 'block';

    // Load saved Bridge IP and API User from sessionStorage
    const savedIp = sessionStorage.getItem(SESSION_STORAGE_IP_KEY);
    const savedApiUser = sessionStorage.getItem(SESSION_STORAGE_API_KEY);

    if (savedIp) {
        bridgeIpInput.value = savedIp;
        bridgeIp = savedIp; // Update state variable as well
    }
    if (savedApiUser) {
        apiUserInput.value = savedApiUser;
        apiUser = savedApiUser; // Update state variable
    }

    // Add listeners to save IP/User on input change
    bridgeIpInput.addEventListener('input', () => {
        bridgeIp = bridgeIpInput
            .value
            .trim();
        sessionStorage.setItem(SESSION_STORAGE_IP_KEY, bridgeIp);
    });

    apiUserInput.addEventListener('input', () => {
        apiUser = apiUserInput
            .value
            .trim();
        sessionStorage.setItem(SESSION_STORAGE_API_KEY, apiUser);
    });
});

fetchLightsBtn.addEventListener('click', async() => {
    // Values are already updated by the 'input' listeners and stored in state vars
    step1Error.textContent = '';
    allV1Lights = null; // Reset state
    v1ToV2IdMap = null; // Reset state

    if (!bridgeIp || !apiUser) {
        step1Error.textContent = 'Please enter both Bridge IP and API Username.';
        return;
    }

    // Construct base URLs - ALWAYS use HTTPS
    apiV1BaseUrl = `https://${bridgeIp}/api/${apiUser}/`;
    apiV2BaseUrl = `https://${bridgeIp}/clip/v2/`;

    log(`Attempting to connect to bridge via HTTPS...`, 'info');
    fetchLightsBtn.disabled = true;
    fetchLightsBtn.textContent = 'Fetching...';

    try {
        // --- Fetch V1 Lights (Primary source for dropdowns) ---
        log(`Fetching V1 lights from ${apiV1BaseUrl}lights...`, 'info');
        const v1Data = await apiRequest(`${apiV1BaseUrl}lights`, 'GET');
        if (!v1Data || typeof v1Data !== 'object') { // Basic validation
            throw new Error('Invalid V1 light data received.');
        }
        allV1Lights = v1Data;
        log(`Successfully fetched ${Object.keys(allV1Lights).length} V1 lights.`, 'success');

        // --- Fetch V2 Lights (To get V2 GUIDs) ---
        log(`Fetching V2 lights from ${apiV2BaseUrl}resource/light...`, 'info');
        // V2 /resource endpoint requires the header even for GET
        const v2Data = await apiRequest(`${apiV2BaseUrl}resource/light`, 'GET', null, apiUser, true);

        if (!v2Data || !Array.isArray(v2Data.data)) {
            throw new Error('Invalid V2 light data received.');
        }
        log(`Successfully fetched ${v2Data.data.length} V2 light resources.`, 'success');

        // --- Create V1 to V2 ID Map ---
        v1ToV2IdMap = {};
        v2Data
            .data
            .forEach(light => {
                if (light.id_v1) {
                    // Extract V1 ID (e.g., "32" from "/lights/32")
                    const v1IdMatch = light
                        .id_v1
                        .match(/\/lights\/(\d+)$/);
                    if (v1IdMatch && v1IdMatch[1]) {
                        v1ToV2IdMap[v1IdMatch[1]] = light.id; // Map V1 numeric ID to V2 GUID
                    }
                }
            });
        log(`Created V1-to-V2 ID map for ${Object.keys(v1ToV2IdMap).length} lights.`, 'info');
        // Optional: Log if any V1 lights couldn't be mapped
        const v1Ids = Object.keys(allV1Lights);
        const mappedV1Ids = Object.keys(v1ToV2IdMap);
        const unmappedCount = v1Ids
            .filter(id => !mappedV1Ids.includes(id))
            .length;
        if (unmappedCount > 0) {
            log(`${unmappedCount} V1 lights could not be mapped to a V2 ID (this might be normal for older scenes/setups).`, 'warning');
        }

        // --- Populate Dropdowns (using V1 data) ---
        oldLightSelect.innerHTML = '<option value="">-- Select Old Bulb --</option>';
        newLightSelect.innerHTML = '<option value="">-- Select New Bulb --</option>';

        const sortedLightV1Ids = Object
            .keys(allV1Lights)
            .sort((a, b) => allV1Lights[a].name.localeCompare(allV1Lights[b].name));
        sortedLightV1Ids.forEach(id => {
            const name = allV1Lights[id].name;
            const optionOld = document.createElement('option');
            optionOld.value = id; // Use V1 ID as value
            optionOld.textContent = `${name} (V1 ID: ${id})`;
            oldLightSelect.appendChild(optionOld);

            const optionNew = document.createElement('option');
            optionNew.value = id; // Use V1 ID as value
            optionNew.textContent = `${name} (V1 ID: ${id})`;
            newLightSelect.appendChild(optionNew);
        });

        // --- Show next steps ---
        step1Div
            .classList
            .add('hidden');
        step2Div
            .classList
            .remove('hidden');
        step3Div
            .classList
            .remove('hidden'); // Show log box
        clearLog(); // Clear fetching logs
        log('Select the OLD bulb to replace and the NEW bulb to inherit its settings.', 'info');

    } catch (error) {
        log(`Error fetching lights: ${error.message}`, 'error');
        step1Error.textContent = `Error: ${error.message}. Please check IP, Username, network, and ensure the certificate is trusted in your browser.`;
        // Clear potentially invalid state
        apiV1BaseUrl = '';
        apiV2BaseUrl = '';
        allV1Lights = null;
        v1ToV2IdMap = null;
    } finally {
        fetchLightsBtn.disabled = false;
        fetchLightsBtn.textContent = 'Fetch Lights';
    }
});

// Update confirmation when selections change or alt rename checkbox is toggled
[oldLightSelect, newLightSelect, altRenameCheck].forEach(element => {
    // Use 'input' for checkbox to catch changes immediately
    const eventType = element.type === 'checkbox'
        ? 'input'
        : 'change';
    element.addEventListener(eventType, updateConfirmation);
});

// --- Helper function to recursively search and modify configuration ---
/**
         * Recursively searches an object/array for light references and adds the new light if the old one is found.
         * Modifies the object/array in place.
         * @param {any} obj - The object or array to search within.
         * @param {string} oldLightRid - The V2 ID of the old light to find.
         * @param {string} newLightRid - The V2 ID of the new light to add.
         * @returns {boolean} - True if any modification was made, false otherwise.
         */
function addLightReference(obj, oldLightRid, newLightRid) {
    let modified = false;
    if (Array.isArray(obj)) {
        // If it's an array, iterate through its items
        for (let i = 0; i < obj.length; i++) {
            const item = obj[i];
            // Check if this item is a light reference matching the old bulb
            if (typeof item === 'object' && item !== null && item.rid === oldLightRid && item.rtype === 'light') {
                // Found the old light. Check if the new light is already in this specific array
                const newLightExists = obj.some(existingItem => typeof existingItem === 'object' && existingItem !== null && existingItem.rid === newLightRid && existingItem.rtype === 'light');
                if (!newLightExists) {
                    log(`    -> Found old light ref (${oldLightRid}), adding new light ref (${newLightRid}) to array.`, 'info');
                    obj.push({rid: newLightRid, rtype: 'light'});
                    modified = true;
                    // Important: Don't break here, continue checking other items in the same array
                    // in case the old light was added multiple times (unlikely but possible)
                } else {
                    log(`    -> Found old light ref (${oldLightRid}), but new light ref (${newLightRid}) already exists in this array. Skipping add.`, 'info');
                }
            } else if (typeof item === 'object' || Array.isArray(item)) {
                // Recursively search nested objects/arrays within the array item
                if (addLightReference(item, oldLightRid, newLightRid)) {
                    modified = true;
                }
            }
        }
    } else if (typeof obj === 'object' && obj !== null) {
        // If it's an object, iterate through its properties
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = obj[key];
                // Recursively search nested objects/arrays within the object property
                if (typeof value === 'object' || Array.isArray(value)) {
                    if (addLightReference(value, oldLightRid, newLightRid)) {
                        modified = true;
                    }
                }
            }
        }
    }
    return modified;
}

/**
         * Checks if an identical condition/action address already exists in an array.
         * @param {Array<object>} itemsArray - The array of conditions or actions.
         * @param {string} newAddress - The address string to check for.
         * @returns {boolean} - True if an item with the exact address exists, false otherwise.
         */
function itemAddressExists(itemsArray, newAddress) {
    if (!itemsArray) 
        return false;
    return itemsArray.some(item => item && item.address === newAddress);
}

// ---------------------------------------------------------------------------------------------------------------------------------------

startReplacementBtn.addEventListener('click', async() => {
    if (!selectedOldLightV1Id || !selectedNewLightV1Id || selectedOldLightV1Id === selectedNewLightV1Id) {
        log('Invalid selection. Please select distinct Old and New bulbs.', 'error');
        return;
    }
    if (!allV1Lights || !allV1Lights[selectedOldLightV1Id] || !allV1Lights[selectedNewLightV1Id]) {
        log('V1 light data is missing. Cannot proceed. Please Fetch Lights again.', 'error');
        step2Error.textContent = 'Error: V1 light data missing. Fetch lights again.';
        return;
    }
    if (!v1ToV2IdMap) {
        log('V1-to-V2 ID map is missing. Cannot proceed with V2 renaming. Please Fetch Lights' +
                ' again.',
        'error');
        step2Error.textContent = 'Error: V1-to-V2 ID map missing. Fetch lights again.';
        return;
    }

    // --- Get V2 IDs ---
    const oldLightV2Id = v1ToV2IdMap[selectedOldLightV1Id];
    const newLightV2Id = v1ToV2IdMap[selectedNewLightV1Id];

    if (!oldLightV2Id) {
        log(`Could not find V2 ID for OLD bulb V1 ID: ${selectedOldLightV1Id}. Cannot perform V2 rename for this bulb.`, 'error');
        step2Error.textContent = `Error: Missing V2 ID for Old Bulb (${selectedOldLightV1Id}).`;
        // Optionally allow proceeding with only V1 changes, or stop here. Stopping is
        // safer. return; // Uncomment to stop if V2 ID is missing
    }
    if (!newLightV2Id) {
        log(`Could not find V2 ID for NEW bulb V1 ID: ${selectedNewLightV1Id}. Cannot perform V2 rename for this bulb.`, 'error');
        step2Error.textContent = `Error: Missing V2 ID for New Bulb (${selectedNewLightV1Id}).`;
        // Optionally allow proceeding with only V1 changes, or stop here. Stopping is
        // safer. return; // Uncomment to stop if V2 ID is missing
    }
    log(`Found V2 IDs - Old: ${oldLightV2Id || 'N/A'}, New: ${newLightV2Id || 'N/A'}`, 'info');

    // --- Get Old Bulb's Startup Config ---
    let oldStartupConfig = null;
    try {
        // Navigate safely through the potentially missing properties
        oldStartupConfig = allV1Lights[selectedOldLightV1Id]
            ?.config
                ?.startup;
        if (oldStartupConfig) {
            log(`Found startup config for OLD bulb (V1 ${selectedOldLightV1Id}): ${JSON.stringify(oldStartupConfig)}`, 'info');
        } else {
            log(`Startup config not found for OLD bulb (V1 ${selectedOldLightV1Id}). Skipping startup copy.`, 'warning');
        }
    } catch (e) {
        log(`Error accessing startup config for OLD bulb: ${e.message}. Skipping startup copy.`, 'warning');
        oldStartupConfig = null;
    }

    // --- Disable controls during operation ---
    startReplacementBtn.disabled = true;
    startReplacementBtn.textContent = 'Working...';
    oldLightSelect.disabled = true;
    newLightSelect.disabled = true;
    altRenameCheck.disabled = true; // Disable checkbox during operation
    clearLog();

    const originalOldLightName = allV1Lights[selectedOldLightV1Id].name;
    const currentNewLightName = allV1Lights[selectedNewLightV1Id].name; // Not used currently, but good to have

    // --- Determine renaming strategy based on alt rename mode and checkbox ---
    const useAltRename = altRenameCheck.checked;
    let oldBulbTargetName = '';
    let newBulbTargetName = '';

    if (useAltRename) {
        oldBulbTargetName = originalOldLightName; // Keep original name
        newBulbTargetName = `${originalOldLightName} (new)`;
        log('ALTERNATE RENAME ACTIVE:', 'warning');
        log(` -> Old bulb (V1 ${selectedOldLightV1Id}) will KEEP its name: '${oldBulbTargetName}'`, 'warning');
        log(` -> New bulb (V1 ${selectedNewLightV1Id}) will be renamed to: '${newBulbTargetName}'`, 'warning');
    } else {
        oldBulbTargetName = `${originalOldLightName} (old)`;
        newBulbTargetName = originalOldLightName; // Inherit original name
        log('Standard Rename Process:', 'info');
        log(` -> Old bulb (V1 ${selectedOldLightV1Id}) will be renamed to: '${oldBulbTargetName}'`, 'info');
        log(` -> New bulb (V1 ${selectedNewLightV1Id}) will be renamed to: '${newBulbTargetName}'`, 'info');
    }
    log(`(Both V1 & V2 APIs will be updated for names)`, 'info');

    try {
        // --- Step 1: Find V1 Groups containing the old bulb ---
        log('Step 1/6: Finding groups containing the old bulb (V1 API)...', 'info');
        const groupsData = await apiRequest(`${apiV1BaseUrl}groups`, 'GET');
        const groupsWithOldLight = [];
        for (const groupId in groupsData) {
            // Check if the 'lights' array exists and includes the old light ID
            if (groupsData[groupId]
                ?.lights
                    ?.includes(selectedOldLightV1Id)) {
                groupsWithOldLight.push(groupId);
            }
        }
        log(`Found ${groupsWithOldLight.length} V1 groups: [${groupsWithOldLight.join(', ')}]`, 'info');

        // --- Step 2: Add new bulb to relevant V1 Groups ---
        log('Step 2/6: Adding new bulb to relevant groups (V1 API)...', 'info');
        for (const groupId of groupsWithOldLight) {
            try {
                const group = await apiRequest(`${apiV1BaseUrl}groups/${groupId}`, 'GET');
                const currentLights = group.lights || [];
                if (!currentLights.includes(selectedNewLightV1Id)) {
                    const updatedLights = [
                        ...currentLights,
                        selectedNewLightV1Id
                    ];
                    await apiRequest(`${apiV1BaseUrl}groups/${groupId}`, 'PUT', {lights: updatedLights});
                    log(` -> Added new bulb ${selectedNewLightV1Id} to V1 group ${groupId} ('${group.name}')`, 'success');
                } else {
                    log(` -> New bulb ${selectedNewLightV1Id} already in V1 group ${groupId} ('${group.name}')`, 'info');
                }
                await sleep(250); // Small delay between API calls
            } catch (groupError) {
                log(` -> Error updating V1 group ${groupId}: ${groupError.message}`, 'error');
            }
        }

        // --- Step 3: Copy V1 Scene Lightstates ---
        log('Step 3/6: Copying scene lightstates (V1 API)...', 'info');
        const scenesData = await apiRequest(`${apiV1BaseUrl}scenes`, 'GET');
        const scenesWithOldLight = [];
        // First pass: Fetch all scenes and identify relevant ones without modifying yet
        for (const sceneId in scenesData) {
            try {
                // Fetch full scene details to check lightstates and lights array
                const scene = await apiRequest(`${apiV1BaseUrl}scenes/${sceneId}`, 'GET');
                // Check if old light is in the explicit lights list OR has a specific state
                // defined
                if (scene
                    ?.lights
                        ?.includes(selectedOldLightV1Id) || scene
                            ?.lightstates
                                ?.[selectedOldLightV1Id]) {
                    scenesWithOldLight.push({id: sceneId, name: scene.name, data: scene}); // Store full data
                }
            } catch (sceneFetchError) {
                log(` -> Error fetching details for V1 scene ${sceneId}: ${sceneFetchError.message}`, 'warning');
            }
            await sleep(50); // Small delay even during fetching
        }
        log(`Found ${scenesWithOldLight.length} V1 scenes potentially involving the old bulb. Processing modifications...`, 'info');

        // Second pass: Modify the identified scenes
        for (const sceneInfo of scenesWithOldLight) {
            const sceneId = sceneInfo.id;
            const sceneName = sceneInfo.name || `Scene ${sceneId}`;
            const scene = sceneInfo.data; // Use stored data
            try {
                const oldLightState = scene.lightstates
                    ?.[selectedOldLightV1Id];
                let sceneModified = false;

                // Copy light state if it exists for the old bulb
                if (oldLightState) {
                    await apiRequest(`${apiV1BaseUrl}scenes/${sceneId}/lightstates/${selectedNewLightV1Id}`, 'PUT', oldLightState);
                    log(` -> Copied V1 state from old bulb to new bulb in scene '${sceneName}' (ID: ${sceneId})`, 'success');
                    sceneModified = true;
                } else {
                    log(` -> Old bulb V1 state not found in scene '${sceneName}' (ID: ${sceneId}), skipping state copy.`, 'info');
                }

                // Add new light to the scene's light list if old was present and new isn't
                if (scene.lights
                    ?.includes(selectedOldLightV1Id) && !scene.lights
                        ?.includes(selectedNewLightV1Id)) {
                    const updatedLights = [
                        ...scene.lights,
                        selectedNewLightV1Id
                    ];
                    try {
                        await apiRequest(`${apiV1BaseUrl}scenes/${sceneId}`, 'PUT', {lights: updatedLights});
                        log(` -> Added new bulb to V1 light list for scene '${sceneName}' (ID: ${sceneId})`, 'success');
                        sceneModified = true;
                    } catch (sceneLightListError) {
                        log(` -> Failed to add new bulb to V1 light list for scene '${sceneName}' (ID: ${sceneId}): ${sceneLightListError.message}`, 'warning');
                    }
                }

                if (!sceneModified && !oldLightState) {
                    log(` -> No modifications needed for scene '${sceneName}' (ID: ${sceneId})`, 'info');
                }

                await sleep(250); // Delay between modifying scenes
            } catch (sceneError) {
                log(` -> Error processing V1 scene '${sceneName}' (ID: ${sceneId}): ${sceneError.message}`, 'error');
            }
        }

        // --- Step: Update V1 Rules ---
        log('Step X/Y: Checking V1 Rules...', 'info'); // Keep step numbers generic as requested
        let allRules = {};
        try {
            allRules = await apiRequest(`${apiV1BaseUrl}rules`, 'GET');
            if (!allRules || typeof allRules !== 'object') {
                allRules = {}; // Ensure it's an object even if empty/error
                log(' -> Could not fetch or parse V1 rules, or no rules exist.', 'warning');
            } else {
                log(` -> Fetched ${Object.keys(allRules).length} V1 rules.`, 'info');
            }
        } catch (ruleError) {
            log(` -> Error fetching V1 rules: ${ruleError.message}. Skipping rule update step.`, 'error');
            allRules = {}; // Prevent further processing if fetch failed
        }

        let updatedRulesCount = 0;
        const oldLightAddressPrefix = `/lights/${selectedOldLightV1Id}/`;
        const newLightAddressPrefix = `/lights/${selectedNewLightV1Id}/`;

        for (const ruleId in allRules) {
            if (!Object.prototype.hasOwnProperty.call(allRules, ruleId)) 
                continue;
            
            const rule = allRules[ruleId];
            let needsUpdate = false;
            let modifiedConditions = rule.conditions
                ? JSON.parse(JSON.stringify(rule.conditions))
                : []; // Deep copy or init empty
            let modifiedActions = rule.actions
                ? JSON.parse(JSON.stringify(rule.actions))
                : []; // Deep copy or init empty

            // Check Conditions
            if (rule.conditions) {
                rule
                    .conditions
                    .forEach(condition => {
                        if (condition.address && condition.address.startsWith(oldLightAddressPrefix)) {
                            const addressSuffix = condition
                                .address
                                .substring(oldLightAddressPrefix.length);
                            const newAddress = newLightAddressPrefix + addressSuffix;
                            // Check if the exact condition for the new light already exists in the ORIGINAL
                            // rule
                            if (!itemAddressExists(rule.conditions, newAddress)) {
                                const newCondition = {
                                    ...condition,
                                    address: newAddress
                                }; // Create new condition object
                                modifiedConditions.push(newCondition);
                                log(`    -> Rule ${ruleId}: Adding condition for new light: ${newAddress}`, 'info');
                                needsUpdate = true;
                            } else {
                                log(`    -> Rule ${ruleId}: Condition for new light (${newAddress}) already exists.`, 'info');
                            }
                        }
                    });
            }

            // Check Actions
            if (rule.actions) {
                rule
                    .actions
                    .forEach(action => {
                        if (action.address && action.address.startsWith(oldLightAddressPrefix)) {
                            const addressSuffix = action
                                .address
                                .substring(oldLightAddressPrefix.length);
                            const newAddress = newLightAddressPrefix + addressSuffix;
                            // Check if the exact action for the new light already exists in the ORIGINAL
                            // rule
                            if (!itemAddressExists(rule.actions, newAddress)) {
                                const newAction = {
                                    ...action,
                                    address: newAddress
                                }; // Create new action object
                                modifiedActions.push(newAction);
                                log(`    -> Rule ${ruleId}: Adding action for new light: ${newAddress}`, 'info');
                                needsUpdate = true;
                            } else {
                                log(`    -> Rule ${ruleId}: Action for new light (${newAddress}) already exists.`, 'info');
                            }
                        }
                    });
            }

            // If modifications were made, PUT the update
            if (needsUpdate) {
                log(`    -> Rule ${ruleId} ('${rule.name}') requires update. Attempting PUT...`, 'info');
                const updatePayload = {};
                // Only include conditions/actions if they were actually modified or existed
                if (modifiedConditions.length > 0) 
                    updatePayload.conditions = modifiedConditions;
                if (modifiedActions.length > 0) 
                    updatePayload.actions = modifiedActions;
                
                if (Object.keys(updatePayload).length > 0) { // Ensure payload isn't empty
                    try {
                        await apiRequest(`${apiV1BaseUrl}rules/${ruleId}`, 'PUT', updatePayload);
                        log(`    -> Successfully updated Rule ${ruleId}.`, 'success');
                        updatedRulesCount++;
                    } catch (updateError) {
                        log(`    -> FAILED to update Rule ${ruleId}: ${updateError.message}`, 'error');
                    }
                } else {
                    log(`    -> Rule ${ruleId}: Update skipped (no changes detected after processing).`, 'warning');
                }

                await sleep(300); // Delay between rule updates
            }
        }
        log(` -> Finished checking V1 rules. Attempted updates on ${updatedRulesCount} rules.`, 'info');

        // --- Step 4: Update V2 Behavior Instances (Automations/Timers) ---
        log('Step 4/7: Checking V2 Automations/Timers (Behavior Instances)...', 'info');
        let allBehaviorInstances = [];
        try {
            const behaviorData = await apiRequest(`${apiV2BaseUrl}resource/behavior_instance`, 'GET', null, apiUser, true);
            if (behaviorData && Array.isArray(behaviorData.data)) {
                allBehaviorInstances = behaviorData.data;
                log(` -> Fetched ${allBehaviorInstances.length} behavior instances.`, 'info');
            } else {
                log(' -> Could not fetch or parse behavior instances.', 'warning');
            }
        } catch (bhError) {
            log(` -> Error fetching behavior instances: ${bhError.message}. Skipping update step.`, 'error');
        }

        let updatedInstanceCount = 0;
        for (const instance of allBehaviorInstances) {
            if (!instance.id || !instance.configuration) 
                continue; // Skip if missing essential data
            
            // Use JSON stringify/parse for a quick deep check for the oldLightV2Id
            const configString = JSON.stringify(instance.configuration);
            if (configString.includes(oldLightV2Id)) {
                log(` -> Found potential reference to old light (${oldLightV2Id}) in instance ${instance.id} ('${instance.metadata
                    ?.name || 'Unnamed'}'). Checking details...`, 'info');

                try {
                    // Fetch the full instance details just to be safe, though we might have it
                    // already This is slightly redundant but ensures we have the latest config
                    // before modifying
                    const detailedInstanceData = await apiRequest(`${apiV2BaseUrl}resource/behavior_instance/${instance.id}`, 'GET', null, apiUser, true);
                    const detailedInstance = detailedInstanceData
                        ?.data
                            ?.[0];

                    if (!detailedInstance || !detailedInstance.configuration) {
                        log(`    -> Could not fetch detailed configuration for instance ${instance.id}. Skipping.`, 'warning');
                        continue;
                    }

                    // Deep copy the configuration to modify it safely
                    const originalConfig = detailedInstance.configuration;
                    const modifiedConfig = JSON.parse(JSON.stringify(originalConfig)); // Simple deep copy

                    // Recursively add the new light reference
                    const wasModified = addLightReference(modifiedConfig, oldLightV2Id, newLightV2Id);

                    if (wasModified) {
                        log(`    -> Configuration modified for instance ${instance.id}. Attempting PUT update...`, 'info');
                        await apiRequest(`${apiV2BaseUrl}resource/behavior_instance/${instance.id}`, 'PUT', {
                            configuration: modifiedConfig
                        }, apiUser);
                        log(`    -> Successfully updated configuration for instance ${instance.id}.`, 'success');
                        updatedInstanceCount++;
                    } else {
                        log(`    -> Instance ${instance.id} already includes new light or no modification needed.`, 'info');
                    }
                } catch (updateError) {
                    log(`    -> FAILED to update instance ${instance.id}: ${updateError.message}`, 'error');
                }
                await sleep(300); // Delay between instance updates
            }
        }
        log(` -> Finished checking behavior instances. Updated ${updatedInstanceCount}.`, 'info');

        // --- Step 4: Rename OLD bulb (V1 & V2) ---
        log('Step 4/6: Renaming OLD bulb...', 'info');
        if (oldBulbTargetName !== originalOldLightName) { // Only rename if target name is different
            log(` -> Renaming OLD bulb V1 ID ${selectedOldLightV1Id} to '${oldBulbTargetName}'...`, 'info');
            // V1 Rename
            try {
                await apiRequest(`${apiV1BaseUrl}lights/${selectedOldLightV1Id}`, 'PUT', {name: oldBulbTargetName});
                log(`    - V1 Rename successful.`, 'success');
            } catch (v1RenameError) {
                log(`    - V1 Rename FAILED: ${v1RenameError.message}`, 'error');
            }
            await sleep(100);

            // V2 Rename (only if V2 ID was found)
            if (oldLightV2Id) {
                try {
                    const v2Payload = {
                        metadata: {
                            name: oldBulbTargetName
                        }
                    };
                    await apiRequest(`${apiV2BaseUrl}resource/light/${oldLightV2Id}`, 'PUT', v2Payload, apiUser);
                    log(`    - V2 Rename (ID: ${oldLightV2Id}) successful.`, 'success');
                } catch (v2RenameError) {
                    log(`    - V2 Rename (ID: ${oldLightV2Id}) FAILED: ${v2RenameError.message}`, 'error');
                }
            } else {
                log(`    - V2 Rename skipped (V2 ID not found for V1 ID ${selectedOldLightV1Id}).`, 'warning');
            }
        } else {
            log(` -> Skipping rename for OLD bulb V1 ID ${selectedOldLightV1Id} (keeping name '${originalOldLightName}')`, 'info');
        }
        await sleep(250);

        // --- Step 5: Rename NEW bulb (V1 & V2) ---
        log('Step 5/6: Renaming NEW bulb...', 'info');
        log(` -> Renaming NEW bulb V1 ID ${selectedNewLightV1Id} to '${newBulbTargetName}'...`, 'info');
        // V1 Rename
        try {
            await apiRequest(`${apiV1BaseUrl}lights/${selectedNewLightV1Id}`, 'PUT', {name: newBulbTargetName});
            log(`    - V1 Rename successful.`, 'success');
        } catch (v1RenameError) {
            log(`    - V1 Rename FAILED: ${v1RenameError.message}`, 'error');
        }
        await sleep(100);

        // V2 Rename (only if V2 ID was found)
        if (newLightV2Id) {
            try {
                const v2Payload = {
                    metadata: {
                        name: newBulbTargetName
                    }
                };
                await apiRequest(`${apiV2BaseUrl}resource/light/${newLightV2Id}`, 'PUT', v2Payload, apiUser);
                log(`    - V2 Rename (ID: ${newLightV2Id}) successful.`, 'success');
            } catch (v2RenameError) {
                log(`    - V2 Rename (ID: ${newLightV2Id}) FAILED: ${v2RenameError.message}`, 'error');
            }
        } else {
            log(`    - V2 Rename skipped (V2 ID not found for V1 ID ${selectedNewLightV1Id}).`, 'warning');
        }
        await sleep(250); // Pause after renaming new bulb

        // --- Step 6: Apply Startup Config to NEW bulb (V1 only) ---
        log('Step 6/6: Applying startup configuration to NEW bulb (V1 API)...', 'info');
        if (oldStartupConfig) {
            try {
                // Use the /config endpoint for setting startup behavior
                await apiRequest(`${apiV1BaseUrl}lights/${selectedNewLightV1Id}/config`, 'PUT', {
                    startup: {
                        mode: oldStartupConfig.mode
                    }
                });
                log(` -> Successfully applied startup config to NEW bulb (V1 ${selectedNewLightV1Id}).`, 'success');
            } catch (startupError) {
                log(` -> FAILED to apply startup config to NEW bulb (V1 ${selectedNewLightV1Id}): ${startupError.message}`, 'error');
            }
        } else {
            log(' -> Skipping startup config application (no config found on old bulb).', 'info');
        }

        // --- Completion Summary ---
        log('----------------------------------', 'info');
        log('Replacement process complete!', 'success');
        log('Summary:', 'info');
        log(` - Attempted to set New bulb (V1 ${selectedNewLightV1Id}) name to '${newBulbTargetName}' (V1 & V2).`, 'info');
        log(` - Attempted to set Old bulb (V1 ${selectedOldLightV1Id}) name to '${oldBulbTargetName}' (V1 & V2).`, 'info');
        log(` - Attempted V2 Behavior Instance updates for Old bulb (${oldLightV2Id}) -> New bulb (${newLightV2Id}). Updated ${updatedInstanceCount} instances.`, 'info');
        log(` - Attempted V1 Rule updates for Old bulb (${selectedOldLightV1Id}) -> New bulb (${selectedNewLightV1Id}). Processed ${updatedRulesCount} rules.`, 'info');
        log(` - Attempted to apply startup config from Old bulb to New bulb (V1 only).`, 'info');
        log(` - New bulb added to V1 groups: [${groupsWithOldLight.join(', ')}]`, 'info');
        log(` - Attempted V1 scene state copy/light list update for scenes involving the old bulb.`, 'info');
        log('Please verify in the Hue app and other apps (especially V2 API based ones):', 'warning');
        log(' - Check the final names of the bulbs.', 'warning');
        log(' - Check automations/timers involving the old bulb now correctly include/target ' +
                'the new bulb.',
        'warning');
        log(' - Check V1 Rules involving the old bulb now correctly include/target the new bu' +
                'lb.',
        'warning');
        log(' - Check the startup behavior of the new bulb after a power cycle.', 'warning');
        log(' - Test the groups and scenes involving the original bulb to ensure the new bulb' +
                ' behaves correctly.',
        'warning');

    } catch (error) {
        log(`An critical error occurred during the replacement process: ${error.message}`, 'error');
        log('Process stopped. Please review the logs and check your Hue app. Some steps may h' +
                'ave completed, others may have failed.',
        'error');
    } finally {
        startReplacementBtn.textContent = 'Process Finished';
        // Keep controls disabled after completion/error to prevent accidental re-runs
        // without refresh
    }
});
