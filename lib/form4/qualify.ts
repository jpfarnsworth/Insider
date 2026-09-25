import { isCommonStock } from './normalize';
import type { ParsedTransaction } from './types';

type Candidate = Pick<
  ParsedTransaction,
  'code' | 'acquiredDisposed' | 'isDerivative' | 'price' | 'is10b5_1' | 'securityTitle'
>;

/**
 * Qualifying purchase for cluster detection (spec §3.2): open-market or private
 * purchase (code P), acquired, non-derivative, price > 0, not under a 10b5-1
 * plan, common stock only. A price that appears only in a footnote parses as
 * null and so does not qualify.
 */
export function isQualifyingPurchase(tx: Candidate): boolean {
  return (
    tx.code === 'P' &&
    tx.acquiredDisposed === 'A' &&
    !tx.isDerivative &&
    tx.price !== null &&
    tx.price > 0 &&
    !tx.is10b5_1 &&
    isCommonStock(tx.securityTitle)
  );
}
