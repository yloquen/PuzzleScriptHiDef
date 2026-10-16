'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_FILES = [
    'js/storagewrapper.js',
    'js/bitvec.js',
    'js/level.js',
    'js/languageConstants.js',
    'js/globalVariables.js',
    'js/debug.js',
    'js/font.js',
    'js/rng.js',
    'js/riffwave.js',
    'js/sfxr.js',
    'js/codemirror/stringstream.js',
    'js/colorhelpers.js',
    'js/colors.js',
    'js/engine.js',
    'js/parser.js',
    'js/compiler.js',
    'js/soundbar.js',
];

function installShims() {
    const storage = {};
    global.localStorage = {
        getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
        setItem(key, value) { storage[key] = String(value); },
        removeItem(key) { delete storage[key]; }
    };

    global.document = {
        URL: 'generator://',
        title: '',
        body: {
            classList: { contains() { return false; } },
            addEventListener() {},
            removeEventListener() {}
        },
        createElement() {
            return {
                style: {},
                innerHTML: '',
                textContent: '',
                getContext() { return null; }
            };
        },
        getElementById() { return null; }
    };

    global.window = global;
    global.lastDownTarget = null;
    global.canvas = null;
    global.input = global.document.createElement('TEXTAREA');

    global.canvasResize = function () {};
    global.redraw = function () {};
    global.forceRegenImages = function () {};
    global.consolePrintFromRule = function () {};
    global.consolePrint = function () {};
    global.console_print_raw = global.console.log;
    global.consoleError = function () {};
    global.consoleCacheDump = function () {};
    global.addToDebugTimeline = function () {};
    global.killAudioButton = function () {};
    global.showAudioButton = function () {};
    global.regenSpriteImages = function () {};
    global.jumpToLine = function () {};
    global.printLevel = function () {};
    global.playSound = function () {};

    global.levelString = '';
    global.inputString = '';
    global.outputString = '';
    global.editor = { getValue() { return global.levelString; } };
    global.PuzzleScriptTestAssertions = { push() {}, equal() {} };
    global.UnitTestingThrow = function (error) { throw error; };
}

function loadEngine() {
    installShims();
    const srcDir = path.join(__dirname, '..', 'src');
    let allCode = '';
    for (let i = 0; i < SOURCE_FILES.length; i++) {
        const file = SOURCE_FILES[i];
        allCode += '\n// ---- ' + file + ' ----\n';
        allCode += fs.readFileSync(path.join(srcDir, file), 'utf8');
        allCode += '\n';
    }
    allCode += `
global.__ps = {
    compile: compile,
    processInput: processInput,
    RebuildLevelArrays: RebuildLevelArrays,
    loadLevelFromState: loadLevelFromState,
    Level: Level,
    get state() { return state; },
    get level() { return level; },
    set level(value) { level = value; },
    get STRIDE_OBJ() { return STRIDE_OBJ; },
    get STRIDE_MOV() { return STRIDE_MOV; },
    get errorCount() { return errorCount; },
    get errorStrings() { return errorStrings; },
    setLazy(value) { lazyFunctionGeneration = value; },
    resetFlags() {
        backups = [];
        winning = false;
        againing = false;
        textMode = false;
        titleScreen = false;
        unitTesting = true;
    }
};
`;
    vm.runInThisContext(allCode, { filename: 'puzzlescript-engine.js' });
    return global.__ps;
}

module.exports = { loadEngine };
