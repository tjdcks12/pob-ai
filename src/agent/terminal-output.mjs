// Keep terminal control sequences out of auth URLs/prompts, including sequences split across reads.
export function terminalOutput() {
  let mode = 'text', parameters = '';
  return chunk => {
    let text = '';
    for (const char of String(chunk)) {
      if (mode === 'text') {
        if (char === '\x1b') mode = 'escape';
        else if (char === '\n' || char === '\r' || char === '\t' || char >= ' ') text += char;
      } else if (mode === 'escape') {
        mode = char === ']' ? 'osc' : char === '[' ? 'csi' : 'text';
        parameters = '';
      } else if (mode === 'osc') {
        if (char === '\x07') mode = 'text';
        else if (char === '\x1b') mode = 'osc-end';
      } else if (mode === 'osc-end') mode = char === '\\' ? 'text' : 'osc';
      else if (mode === 'csi') {
        if (char >= '@' && char <= '~') {
          if ('Hf'.includes(char) && (parameters.split(';')[1] ?? '1') === '1') text += '\n';
          mode = 'text';
        } else parameters = (parameters + char).slice(-128);
      }
    }
    return text;
  };
}
