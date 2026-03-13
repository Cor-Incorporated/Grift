interface SpecMarkdownViewerProps {
  markdown: string
}

function renderLine(line: string, index: number) {
  const key = `${index}:${line.slice(0, 40)}`
  if (line.startsWith('### ')) {
    return (
      <h4 key={key} className="text-balance text-base font-semibold text-slate-900">
        {line.slice(4)}
      </h4>
    )
  }

  if (line.startsWith('## ')) {
    return (
      <h3 key={key} className="text-balance text-lg font-semibold text-slate-950">
        {line.slice(3)}
      </h3>
    )
  }

  if (line.startsWith('# ')) {
    return (
      <h2 key={key} className="text-balance text-xl font-semibold text-slate-950">
        {line.slice(2)}
      </h2>
    )
  }

  // NOTE: List items are rendered as individual <p> elements rather than
  // proper <ul>/<ol> containers. Grouping consecutive list items into
  // semantic list elements would require a multi-pass parser.
  if (/^[-*] /.test(line)) {
    return (
      <p key={key} className="pl-4 text-pretty text-sm text-slate-700">
        • {line.slice(2)}
      </p>
    )
  }

  if (/^\d+\. /.test(line)) {
    return (
      <p key={key} className="pl-4 text-pretty text-sm text-slate-700">
        {line}
      </p>
    )
  }

  if (line.trim() === '') {
    return <div key={key} className="h-1" />
  }

  return (
    <p key={key} className="text-pretty text-sm leading-6 text-slate-700">
      {line}
    </p>
  )
}

export function SpecMarkdownViewer({ markdown }: SpecMarkdownViewerProps) {
  return (
    <div className="space-y-3">
      {markdown.split('\n').map((line, index) => renderLine(line, index))}
    </div>
  )
}
