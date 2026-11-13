// Loads Monaco (code editor) on demand from the CDN, and gives a file's language.
import { t } from '../../i18n/index.js';

const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
let monacoReady = null;
export function loadMonaco() {
  monacoReady ??= new Promise((ok, ko) => {
    // Monaco's workers cannot come from another origin: we bootstrap them from a data: URL
    window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
      `self.MonacoEnvironment = { baseUrl: '${MONACO}/../' }; importScripts('${MONACO}/base/worker/workerMain.js');`)}` };
    const s = document.createElement('script');
    s.src = `${MONACO}/loader.js`;
    s.onload = () => { window.require.config({ paths: { vs: MONACO } }); window.require(['vs/editor/editor.main'], () => ok(window.monaco), ko); };
    s.onerror = () => { monacoReady = null; ko(new Error(t('editor.monacoUnreachable'))); };
    document.head.append(s);
  });
  return monacoReady;
}
const LANGUAGES = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', java: 'java', html: 'html', htm: 'html', css: 'css', scss: 'scss',
  json: 'json', jsonl: 'json', md: 'markdown', xml: 'xml', yml: 'yaml', yaml: 'yaml', sql: 'sql', sh: 'shell', ps1: 'powershell',
  py: 'python', gradle: 'groovy', properties: 'ini', vm: 'html', kt: 'kotlin', go: 'go', rs: 'rust', cs: 'csharp', php: 'php',
};
export const languageOf = path => LANGUAGES[(path.split('.').pop() || '').toLowerCase()] || 'plaintext';
