"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Lightweight markdown renderer for assistant messages. Supports GFM (tables,
// strikethrough, task lists) and safe default styling. Links open in a new
// tab. Code blocks use a monospace pre block; no syntax highlighting yet
// (keep bundle small).
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:text-accent/80"
            />
          ),
          code: ({ className, children, ...rest }) => {
            const inline = !className;
            if (inline) {
              return (
                <code
                  {...rest}
                  className="px-1.5 py-0.5 rounded bg-white/10 text-[0.9em] font-mono"
                >
                  {children}
                </code>
              );
            }
            return (
              <code {...rest} className={className}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 p-3 rounded-md bg-black/40 border border-white/10 overflow-x-auto text-sm font-mono">
              {children}
            </pre>
          ),
          ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
          p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
          h1: ({ children }) => <h1 className="text-lg font-semibold mt-3 mb-1.5">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-white/20 pl-3 my-2 text-white/70 italic">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-white/10 px-2 py-1 font-semibold text-left bg-white/5">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-white/10 px-2 py-1">{children}</td>,
          hr: () => <hr className="my-3 border-white/10" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
