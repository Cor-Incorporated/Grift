interface StreamingIndicatorProps {
  content: string
}

export function StreamingIndicator({ content }: StreamingIndicatorProps) {
  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-gray-100 text-gray-900 px-4 py-3">
        {content ? (
          <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
        ) : (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  )
}
