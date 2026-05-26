// Focused billing mode — Rate lists are hidden for now.
// Re-enable by deleting this redirect and restoring the original page.
import { redirect } from 'next/navigation';

export default function RateListEditorPage() {
  redirect('/dashboard');
}
