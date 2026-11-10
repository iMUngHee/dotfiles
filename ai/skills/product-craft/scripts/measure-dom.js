/* Evaluate in the inspected page; returns a report and installs measureDOM(options).
   Run after fonts and images settle. Units are CSS pixels, not screenshot pixels.
   data-measure-ignore excludes a subtree; data-measure-wrap="allow" permits a wrapped label.
   data-measure-row opts a container into centre-line checks; data-measure-single-line
   opts text into wrap checks. Intentional scroll containers are excluded from overflow.
   Cross-origin frames, closed shadow roots and canvas text need their own inspection. */
(() => {
  window.measureDOM = ({ root = document.body, alignmentTolerance = 2, minTargetSize = 24 } = {}) => {
    const findings = [];
    const visible = element => {
      const style = getComputedStyle(element);
      return !element.closest('[data-measure-ignore]') && style.visibility !== 'hidden'
        && style.display !== 'none' && element.getClientRects().length > 0;
    };
    const elements = [root, ...root.querySelectorAll('*')].filter(visible);
    const name = element => element.id ? `#${element.id}` : (() => {
      const parts = [];
      for (let node = element; node && node !== root.parentElement; node = node.parentElement) {
        const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.tagName === node.tagName) : [node];
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
        if (node === root) break;
      }
      return parts.join(' > ');
    })();
    const textRects = element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const rects = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || !visible(node.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0));
      }
      return rects;
    };
    for (const element of elements) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const selector = name(element);
      if (element.matches('button,a[href],input:not([type="hidden"]),select,textarea,[role="button"],[role="tab"]')
        && !element.matches(':disabled')) {
        const labels = element.labels ? [...element.labels].filter(visible) : [];
        const targets = [rect, ...labels.map(label => label.getBoundingClientRect())];
        if (!targets.some(target => target.width >= minTargetSize && target.height >= minTargetSize)) {
          findings.push({ kind: 'target-size', element: selector, width: rect.width, height: rect.height, minimum: minTargetSize });
        }
      }
      const row = element.hasAttribute('data-measure-row') ||
        ((style.display.includes('flex') && style.flexDirection.startsWith('row') || style.display.includes('grid'))
          && style.alignItems === 'center');
      if (row) {
        const children = [...element.children].filter(visible).map(child => ({ child, rect: child.getBoundingClientRect() }));
        for (let left = 0; left < children.length; left++) {
          for (let right = left + 1; right < children.length; right++) {
            const a = children[left], b = children[right];
            const overlap = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
            if (overlap < Math.min(a.rect.height, b.rect.height) / 2) continue;
            const delta = Math.abs(a.rect.top + a.rect.height / 2 - b.rect.top - b.rect.height / 2);
            if (delta > alignmentTolerance) findings.push({ kind: 'alignment', element: selector,
              siblings: [name(a.child), name(b.child)], delta: Math.round(delta * 100) / 100 });
          }
        }
      }
      if (element.matches('button,label,[role="button"],[role="tab"],[role="menuitem"],[data-measure-single-line]')
        && !element.closest('[data-measure-wrap="allow"]')) {
        const lines = [];
        for (const text of textRects(element)) {
          if (!lines.some(line => Math.min(line.bottom, text.bottom) - Math.max(line.top, text.top) > Math.min(line.height, text.height) / 2)) lines.push(text);
        }
        if (lines.length > 1) findings.push({ kind: 'wrap', element: selector, lines: lines.length });
      }
      if (!element.clientWidth || !element.clientHeight || element.tagName === 'HTML') continue;
      const overflowX = element.scrollWidth - element.clientWidth;
      const overflowY = element.scrollHeight - element.clientHeight;
      const badX = overflowX > 1 && !['auto', 'scroll'].includes(style.overflowX);
      const badY = overflowY > 1 && !['auto', 'scroll'].includes(style.overflowY);
      if (!badX && !badY) continue;
      findings.push({ kind: 'overflow', element: selector, x: badX ? overflowX : 0, y: badY ? overflowY : 0 });
      const clipsX = ['hidden', 'clip'].includes(style.overflowX);
      const clipsY = ['hidden', 'clip'].includes(style.overflowY);
      const left = rect.left + element.clientLeft, top = rect.top + element.clientTop;
      if (textRects(element).some(text => clipsX && (text.left < left - 1 || text.right > left + element.clientWidth + 1)
        || clipsY && (text.top < top - 1 || text.bottom > top + element.clientHeight + 1))) {
        findings.push({ kind: 'clipped-text', element: selector });
      }
    }
    const report = { units: 'CSS px', elementsMeasured: elements.length, findings,
      limits: 'Heuristics: review findings for intent. Inspect frames, shadow roots and canvas separately.' };
    console.table(findings);
    return report;
  };
  return window.measureDOM();
})();
