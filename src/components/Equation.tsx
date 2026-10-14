import katex from "katex";
import "katex/dist/katex.min.css";

export default function Equation({ expression }: { expression: string }) {
  return (
    <div
      className="equation"
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(expression, {
          throwOnError: false,
          displayMode: true,
          trust: false,
          output: "htmlAndMathml",
        }),
      }}
    />
  );
}
