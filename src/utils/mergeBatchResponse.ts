type BatchResponse<T> = {
  applied: number;
  failed: number;
  results: T[];
};

export function mergeBatchResponses<T>(
  responses: BatchResponse<T>[],
): BatchResponse<T> {
  return responses.reduce(
    (acc, response) => ({
      applied: acc.applied + response.applied,
      failed: acc.failed + response.failed,
      results: [...acc.results, ...response.results],
    }),
    {
      applied: 0,
      failed: 0,
      results: [],
    } as BatchResponse<T>,
  );
}
