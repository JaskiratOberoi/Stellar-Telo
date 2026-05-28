/**
 * Minimal layout for the print fragment pages. Skips the shop nav / header
 * entirely so the rendered HTML inside the print iframe is just the invoice
 * template plus shared Tailwind. The fragment is requested on click only —
 * see `components/orders/print-bill-button.tsx`.
 */
export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
