import { describe, expect, it } from 'vitest';
import { isCommonStock, isQualifyingPurchase, normalizeSecurityTitle } from './index';

const base = {
  code: 'P',
  acquiredDisposed: 'A' as const,
  isDerivative: false,
  price: 10,
  is10b5_1: false,
  securityTitle: 'Common Stock',
};

describe('isQualifyingPurchase', () => {
  it('accepts an open-market common stock purchase', () => {
    expect(isQualifyingPurchase(base)).toBe(true);
  });

  it.each([
    ['a sale code', { code: 'S' }],
    ['a grant code', { code: 'A' }],
    ['a disposal', { acquiredDisposed: 'D' as const }],
    ['no acquired/disposed code', { acquiredDisposed: null }],
    ['a derivative', { isDerivative: true }],
    ['a missing price', { price: null }],
    ['a zero price', { price: 0 }],
    ['a 10b5-1 plan', { is10b5_1: true }],
    ['preferred stock', { securityTitle: 'Series A Preferred Stock' }],
  ])('rejects %s', (_label, override) => {
    expect(isQualifyingPurchase({ ...base, ...override })).toBe(false);
  });
});

describe('isCommonStock', () => {
  it.each([
    'Common Stock',
    'Common Stock, $0.01 par value',
    'Common Stock, par value $.001 per share',
    'Class A Common Stock',
    'Ordinary Shares',
    'COMMON SHARES',
    'Common Stock (Class B)',
  ])('accepts %s', (title) => expect(isCommonStock(title)).toBe(true));

  it.each([
    'Series B Preferred Stock',
    'Common Stock Warrant',
    'Warrants to purchase Common Stock',
    'Stock Option (Right to Buy) - Common Stock',
    'Common Stock Purchase Rights',
    'Common Units',
    'Convertible Note',
    '5% Notes due 2030',
    'Restricted Stock',
    'American Depositary Shares',
  ])('rejects %s', (title) => expect(isCommonStock(title)).toBe(false));
});

describe('normalizeSecurityTitle', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeSecurityTitle('  Class  A   Common-Stock ')).toBe('class a common stock');
  });

  it('drops par value clauses', () => {
    expect(normalizeSecurityTitle('Common Stock, $0.01 par value')).toBe('common stock');
    expect(normalizeSecurityTitle('Common Stock par value $0.01 per share')).toBe('common stock');
    expect(normalizeSecurityTitle('Common Stock 0.001 par value')).toBe('common stock');
  });
});
