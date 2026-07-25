export function VoidWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`void-wordmark ${className}`.trim()} aria-label="VOID">
      V<span className="void-wordmark-o">O</span>ID
    </span>
  );
}
