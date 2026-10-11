/** Incrementally removes terminal control sequences while preserving readable text. */
export class TerminalControlStripper {
  private state: 'text' | 'escape' | 'csi' | 'osc' | 'string' | 'stringEscape' = 'text'

  write(value: string) {
    let output = ''
    for (const character of value) {
      const code = character.charCodeAt(0)
      if (this.state === 'text') {
        if (code === 0x1b) this.state = 'escape'
        else if (code === 0x9b) this.state = 'csi'
        else if (code === 0x9d) this.state = 'osc'
        else if (code === 0x90 || code === 0x9e || code === 0x9f) this.state = 'string'
        else if (character === '\n' || character === '\r' || character === '\t' || code >= 0x20)
          output += character
        continue
      }
      if (this.state === 'escape') {
        if (character === '[') this.state = 'csi'
        else if (character === ']') this.state = 'osc'
        else if (character === 'P' || character === '^' || character === '_') this.state = 'string'
        else this.state = 'text'
        continue
      }
      if (this.state === 'csi') {
        if (code >= 0x40 && code <= 0x7e) this.state = 'text'
        continue
      }
      if (this.state === 'osc') {
        if (code === 0x07) this.state = 'text'
        else if (code === 0x1b) this.state = 'stringEscape'
        continue
      }
      if (this.state === 'string') {
        if (code === 0x1b) this.state = 'stringEscape'
        continue
      }
      if (this.state === 'stringEscape') this.state = character === '\\' ? 'text' : 'string'
    }
    return output
  }
}
