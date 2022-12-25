const log = require('fancy-log'),
    jsdom = require('jsdom'),
    {
        malClientId,
        ignoreBrackets,
        ignoreFiletype,
        replaceUnderscore,
        showRemainingTime,
        replaceDots,
    } = require('./config'),
    { JSDOM } = jsdom,
    fetch = require("node-fetch");

// Discord Rich Presence has a string length limit of 128 characters.
// This little plugin (based on https://stackoverflow.com/a/43006978/7090367)
// helps by trimming strings up to a given length.
String.prototype.trimStr = function (length) {
    return this.length > length ? this.substring(0, length - 3) + "..." : this;
};

// Defines playback data fetched from MPC.
let playback = {
    filename: '',
    position: '',
    duration: '',
    fileSize: '',
    state: '',
    prevState: '',
    prevPosition: '',
};

// Defines strings and image keys according to the 'state' string
// provided by MPC.
const states = {
    '-1': {
        string: 'Idling',
        stateKey: 'stop_small'
    },
    '0': {
        string: 'Stopped',
        stateKey: 'stop_small'
    },
    '1': {
        string: 'Paused',
        stateKey: 'pause_small'
    },
    '2': {
        string: 'Playing',
        stateKey: 'play_small'
    }
};

/**
 * Sends Rich Presence updates to Discord client.
 */
const updatePresence = async (res, rpc) => {
    // Gets a DOM object based on MPC Web Interface variables page.
    const { document } = new JSDOM(res).window;

    // Gets relevant info from the DOM object.
    let filename = playback.filename = document.getElementById('filepath').textContent.split("\\").pop().trimStr(128);
    playback.state = document.getElementById('state').textContent;
    playback.duration = sanitizeTime(document.getElementById('durationstring').textContent);
    playback.position = sanitizeTime(document.getElementById('positionstring').textContent);

    // Replaces underscore characters to space characters
    if (replaceUnderscore) playback.filename = playback.filename.replace(/_/g, " ");

    // Removes brackets and its content from filename if `ignoreBrackets` option
    // is set to true
    if (ignoreBrackets) {
        playback.filename = playback.filename.replace(/ *\[[^\]]*]/g, "").trimStr(128);
        if (cleanFormat(playback.filename).length === 0) playback.filename = filename;
    }

    // Replaces dots in filenames to space characters
    // Solution found at https://stackoverflow.com/a/28673744
    if (replaceDots) {
        playback.filename = playback.filename.replace(/[.](?=.*[.])/g, " ");
    }

    // Removes filetype from displaying
    if (ignoreFiletype) playback.filename = cleanFormat(playback.filename);
    const cleanedFilename = cleanFormat(playback.filename);

    // Prepares playback data for Discord Rich Presence.
    let payload = {
        startTimestamp: undefined,
        endTimestamp: undefined,
        details: `Watching ${cleanedFilename.length > 20 ? cleanFormat(cleanedFilename.substring(0, 20), ' ') + '-' : cleanedFilename}`,
        largeImageKey: await getAnimeCoverURI(cleanedFilename),
        largeImageText: cleanedFilename
    };

    if (cleanedFilename.length > 20) {
        payload.state = cleanedFilename.substring(20, cleanedFilename.length);
    }

    // Makes changes to payload data according to playback state.
    switch (playback.state) {
        case '-1': // Idling
            payload.state = states[playback.state].string;
            payload.details = undefined;
            break;
        case '1': // Paused
            payload.state = playback.position + ' / ' + playback.duration;
            break;
        case '2': // Playing
            if (showRemainingTime) {
                payload.endTimestamp = Date.now() + (convert(playback.duration) - convert(playback.position));
            } else {
                payload.startTimestamp = Date.now() - convert(playback.position);
            }
            break;
    }

    // Only sends presence updates if playback state changes or if playback position
    // changes while playing.
    if ((playback.state !== playback.prevState) || (
        playback.state === '2' &&
        convert(playback.position) !== convert(playback.prevPosition) + 5000
    )) {
        rpc.setActivity(payload)
            .catch((err) => {
                log.error('ERROR: ' + err);
            });
        log.info('INFO: Presence update sent: ' +
            `${states[playback.state].string} - ${playback.position} / ${playback.duration} - ${playback.filename}`
        );
    }

    // Replaces previous playback state and position for later comparison.
    playback.prevState = playback.state;
    playback.prevPosition = playback.position;
    return true;
};

const getAnimeCoverURI = async (title) => {
    let uri = "anime-questionmark-removebg";

    const headers = new fetch.Headers();
    headers.append('X-MAL-CLIENT-ID', malClientId.length <= 0 ? process.env.MAL_CLIENT_ID : malClientId);

    const requestOptions = {
        method: 'GET',
        headers: headers,
        redirect: 'follow'
    };

    try {
        const response = await fetch(`https://api.myanimelist.net/v2/anime?q=${title}&limit=1`, requestOptions);
        const result = await response.json();

        uri = result.data[0].node.main_picture.medium
    } catch (e) {}

    return uri
}

const cleanFormat = (string, cleaned = '.') => {
    return string.substr(0, string.lastIndexOf(cleaned));
}

/**
 * Simple and quick utility to convert time from 'hh:mm:ss' format to milliseconds.
 * @param {string} time Time string formatted as 'hh:mm:ss'
 * @returns {number} Number of milliseconds converted from the given time string
 */
const convert = time => {
    let parts = time.split(':'),
        seconds = parseInt(parts[parts.length - 1]),
        minutes = parseInt(parts[parts.length - 2]),
        hours = (parts.length > 2) ? parseInt(parts[0]) : 0;
    return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1000;
};

/**
 * In case the given 'hh:mm:ss' formatted time string is less than 1 hour,
 * removes the '00' hours from it.
 * @param {string} time Time string formatted as 'hh:mm:ss'
 * @returns {string} Time string without '00' hours
 */
const sanitizeTime = time => {
    if (time.split(':')[0] === '00') {
        return time.substr(3, time.length - 1);
    }
    return time;
};

module.exports = updatePresence;
