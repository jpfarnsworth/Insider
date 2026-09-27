import type { RulePreview } from '@/lib/clusters/store';

export interface FormState {
  status: 'idle' | 'ok' | 'error';
  message?: string;
  preview?: RulePreview;
}

