import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildVotingPool,
  aggregateVotes,
  selectFinalists,
} from './voting';
import type { ReflectionStep, SafetyAlert } from '../types';

describe('Voting helpers', () => {
  describe('buildVotingPool', () => {
    it('should exclude red-flagged responses', () => {
      const responses = [
        { id: 'r1', alerts: [{ severity: 'red', category: 'self_harm' } as SafetyAlert] },
        { id: 'r2', alerts: [] },
      ];
      const result = buildVotingPool(responses);
      expect(result.eligibleReflectionIds).toEqual(['r2']);
      expect(result.excludedByRedAlertIds).toEqual(['r1']);
    });

    it('should separate amber-flagged responses', () => {
      const responses = [
        { id: 'r1', alerts: [{ severity: 'amber', category: 'low_depth' } as SafetyAlert] },
        { id: 'r2', alerts: [] },
      ];
      const result = buildVotingPool(responses);
      expect(result.eligibleReflectionIds).toContain('r1');
      expect(result.eligibleReflectionIds).toContain('r2');
      expect(result.excludedByAmberAlertIds).toEqual(['r1']);
    });
  });

  describe('aggregateVotes', () => {
    it('should count votes per reflection', () => {
      const votes = [
        { reflectionId: 'r1', round: 1 },
        { reflectionId: 'r1', round: 1 },
        { reflectionId: 'r2', round: 1 },
      ];
      const result = aggregateVotes(votes, 1);
      expect(result).toEqual({
        r1: 2,
        r2: 1,
      });
    });

    it('should filter by round', () => {
      const votes = [
        { reflectionId: 'r1', round: 1 },
        { reflectionId: 'r1', round: 2 },
      ];
      const result = aggregateVotes(votes, 1);
      expect(result).toEqual({ r1: 1 });
    });
  });

  describe('selectFinalists', () => {
    it('should select top 4 for large class', () => {
      const voteCounts = { r1: 8, r2: 6, r3: 4, r4: 2, r5: 1 };
      const result = selectFinalists(voteCounts, 12);
      expect(result).toHaveLength(4);
      expect(result[0]).toBe('r1');
    });

    it('should select top 3 for small class (5-7)', () => {
      const voteCounts = { r1: 4, r2: 3, r3: 2 };
      const result = selectFinalists(voteCounts, 6);
      expect(result).toHaveLength(3);
    });

    it('should handle ties', () => {
      const voteCounts = { r1: 5, r2: 5, r3: 3 };
      const result = selectFinalists(voteCounts, 8);
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result).toContain('r1');
      expect(result).toContain('r2');
    });
  });
});
