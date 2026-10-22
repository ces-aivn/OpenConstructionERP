// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Whether search by meaning can answer on this installation right now.
 *
 * The cost database used to show its "AI search" switch whatever the state of
 * the embedding model: with semantic search off (the default) or the model
 * not downloaded, the switch turned on, every search fell back to text search
 * and a banner explained why. The switch is now offered only when the model
 * is ready; until then the page simply searches by text.
 *
 * Reads the same status query as the Settings hint (`embedding-model-status`),
 * so both agree and the server is asked once.
 */
import { useQuery } from '@tanstack/react-query';
import { aiEstimatorApi, type EmbeddingModelState } from '@/features/ai-estimator/api';

export function semanticSearchReady(state: EmbeddingModelState | undefined): boolean {
  return state === 'ready';
}

export function useSemanticSearchReady(): boolean {
  const { data } = useQuery({
    queryKey: ['embedding-model-status'],
    queryFn: aiEstimatorApi.embeddingModelStatus,
    retry: false,
    staleTime: 60_000,
  });
  return semanticSearchReady(data?.state);
}
