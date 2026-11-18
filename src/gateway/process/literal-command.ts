// Literal forms compile to an ordinary, readable command BEFORE any permission checks.
// Only the checked text is later consumed by the process supervisor (no side-channel argv).
export const ARGV_SUFFIX = ' # prom:literal-argv';
const bare = /^[A-Za-z0-9_.:/\\=+*?-]+$/;
const programs = /^(?:git|node|rg)(?:\.exe)?$/i;
// PowerShell recognizes typographic quotes as delimiters too; don't cross dialects here.
const unsupported = /[\x00-\x1f\x7f\u2018-\u201e]/;
function word(x: unknown): string {
  if (typeof x !== 'string' || unsupported.test(x) || x.length > 16000) throw new Error('Expected a single-line literal argument (no control or typographic quote characters).');
  return bare.test(x) && !x.startsWith('@') && x !== '--%' ? x : `'${x.replace(/'/g, "''")}'`;
}
export function literalCommand(input: any): string {
  if (input.search != null) {
    const s = input.search;
    if (input.program != null || input.argv != null || !s || typeof s !== 'object' || typeof s.text !== 'string' || (s.regex != null && typeof s.regex !== 'boolean')) throw new Error('Use search:{text, directory?, glob?, regex?} or program/argv, not both.');
    const dir = s.directory ?? '.';
    if (typeof dir !== 'string' || !dir || /[*?]/.test(dir)) throw new Error('directory must be a literal directory; put filename patterns in glob.');
    return literalCommand({program:'rg',argv:['-n',...(s.regex ? [] : ['-F']),...(s.glob == null ? [] : ['-g', s.glob]),'-e',s.text,'--',dir]});
  }
  if (typeof input.program !== 'string' || !programs.test(input.program) || !Array.isArray(input.argv) || input.argv.length > 128) throw new Error('Use program git, node or rg with argv (up to 128 strings).');
  return [input.program, ...input.argv.map(word)].join(' ');
}
// Parse only complete literal statements. On any uncertain syntax, keep the entire shell script intact.
export function literalStatements(source: string): {text:string; words:string[]}[] | null {
  const token = /(?:'(?:[^'\r\n\u2018-\u201e]|'')*'|"[^"$`\r\n\u2018-\u201e]*"|[A-Za-z0-9_.:/\\=+*?-]+)/y;
  const out: {text:string; words:string[]}[]=[];
  let i=0, start=0, words:string[]=[];
  function finish(){ if(!words.length) return false; out.push({text:source.slice(start,i).trim(),words}); words=[]; return out.length<=32; }
  while(i<source.length){
    if(/[ \t]/.test(source[i])) {i++; continue;}
    if(source[i]===';' || source[i]==='\n' || source[i]==='\r') { if(words.length && !finish())return null; start=++i; continue; }
    token.lastIndex=i; const m=token.exec(source); if(!m)return null;
    const t=m[0]; if(t==='--%' || (words.length===0 && /^["']/.test(t) && !/^\s*(?:;|$)/.test(source.slice(token.lastIndex))))return null;
    words.push(t[0]==="'" ? t.slice(1,-1).replace(/''/g,"'") : t[0]==='"' ? t.slice(1,-1) : t);
    i=token.lastIndex; if(i<source.length && !/[ \t;\r\n]/.test(source[i]))return null;
  }
  if(words.length && !finish())return null;
  return out.length ? out : null;
}
export function literalNativeArgv(command:string): string[] | null {
  const s=literalStatements(command); if(s?.length!==1 || !programs.test(s[0].words[0]) || /^["']/.test(s[0].text))return null;
  const [program,...argv] = s[0].words;
  try { return literalCommand({program,argv}) === command ? s[0].words : null; } catch { return null; }
}
// Only instrument standalone, literal commands. Variables, pipes, assignments, redirections,
// logical operators, compound commands and scripts inspecting $?/$LASTEXITCODE keep shell semantics.
export function observedWindowsBatch(command:string):string|null {
  const rows=literalStatements(command); if(!rows || rows.length<2)return null;
  const lines=['$__pmFirstFailure = 0'];
  for(const [index,row] of rows.entries()){
    const exe=row.words[0].toLowerCase(); const literalPrint=/^["']/.test(row.text) && row.words.length===1;
    const native=!literalPrint && /^(?:node|git|rg|cmd)(?:\.exe)?$/.test(exe);
    if(!native && !literalPrint && !/^(?:echo|write-output|write-host)$/.test(exe))return null;
    const search=native && /^rg(?:\.exe)?$/.test(exe);
    if (native) lines.push('$LASTEXITCODE = $null');
    lines.push(row.text,'$__pmStepOK = $?',native?'$__pmCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 1 }':'$__pmCode = if ($__pmStepOK) { 0 } else { 1 }',`$__pmState = if (${search?'($null -ne $LASTEXITCODE -and $__pmCode -eq 1)':'$false'}) { 'no matches' } elseif ($__pmCode -eq 0) { 'ok' } else { if ($__pmFirstFailure -eq 0) { $__pmFirstFailure = $__pmCode }; 'failed' }`,`[Console]::WriteLine("[step ${index+1}/${rows.length}: $__pmState; exit $__pmCode]")`);

  }
  return [...lines,'exit $__pmFirstFailure'].join('\n');
}
