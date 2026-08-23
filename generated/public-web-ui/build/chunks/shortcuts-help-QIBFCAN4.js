import{a as c}from"./chunk-IPNQ4FF4.js";var r=[{title:"General",items:[{combo:"Ctrl + N",desc:"New chat"},{combo:"Ctrl + K",desc:"Open command palette (search chats, pages, actions)"},{combo:"Ctrl + /",desc:"Show this shortcuts list"},{combo:"Esc",desc:"Close dialogs and overlays"}]},{title:"Command Palette",items:[{combo:"\u2191 / \u2193",desc:"Move selection"},{combo:"Enter",desc:"Run selected item"},{combo:"Esc",desc:"Close palette"}]}],e=null,t=null;function a(){if(e)return;e=document.createElement("div"),e.id="shortcuts-help-overlay",e.className="cmdk-overlay",e.style.display="none";let o=r.map(l=>`
    <div class="shortcuts-help-group">
      <div class="shortcuts-help-group-title">${c(l.title)}</div>
      ${l.items.map(n=>`
        <div class="shortcuts-help-row">
          <span class="shortcuts-help-desc">${c(n.desc)}</span>
          <span class="shortcuts-help-combo">${n.combo.split(/\s*\+\s*/).map(i=>`<kbd>${c(i)}</kbd>`).join('<span class="shortcuts-help-plus">+</span>')}</span>
        </div>`).join("")}
    </div>`).join("");e.innerHTML=`
    <div class="cmdk-card shortcuts-help-card">
      <div class="shortcuts-help-header">
        <div class="shortcuts-help-title">Keyboard Shortcuts</div>
        <button class="shortcuts-help-close" type="button" aria-label="Close">\u2715</button>
      </div>
      <div class="shortcuts-help-body">${o}</div>
    </div>`,document.body.appendChild(e),e.addEventListener("click",l=>{l.target===e&&s()}),e.querySelector(".shortcuts-help-close").addEventListener("click",s)}function p(o){o.key==="Escape"&&(o.preventDefault(),s())}function d(){a(),e.style.display="flex",t=p,document.addEventListener("keydown",t,!0)}function s(){!e||e.style.display==="none"||(e.style.display="none",t&&(document.removeEventListener("keydown",t,!0),t=null))}function h(){e&&e.style.display!=="none"?s():d()}window.openShortcutsHelp=d;window.closeShortcutsHelp=s;export{s as closeShortcutsHelp,d as openShortcutsHelp,h as toggleShortcutsHelp};
