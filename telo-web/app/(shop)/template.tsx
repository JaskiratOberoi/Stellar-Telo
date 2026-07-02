/**
 * Re-mounts on every route change inside (shop), giving each page a soft
 * rise-in transition — the App Router way to get page transitions without a
 * client animation library. Respects prefers-reduced-motion.
 */
export default function ShopTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="animate-fade-in-up motion-reduce:animate-none print:animate-none">
      {children}
    </div>
  );
}
