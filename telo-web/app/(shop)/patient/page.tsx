// Focused billing mode — Patients tab is hidden for now.
// Re-enable by deleting this redirect and restoring the original page.
import { redirect } from 'next/navigation';

export default function PatientPage() {
  redirect('/dashboard');
}
