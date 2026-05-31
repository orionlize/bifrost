package logstore

import (
	"context"
)

const (
	defaultClearLogsBatchSize = 500
	maxClearLogsBatches       = 200
	maxClearLogsBatchSize     = 1000
)

type logIDsByFiltersLister interface {
	ListLogIDsByFilters(ctx context.Context, filters SearchFilters, limit int) ([]string, error)
}

func normalizeClearLogsBatchSize(batchSize int) int {
	if batchSize <= 0 {
		return defaultClearLogsBatchSize
	}
	if batchSize > maxClearLogsBatchSize {
		return maxClearLogsBatchSize
	}
	return batchSize
}

func deleteLogsMatchingFilters(ctx context.Context, store LogStore, filters SearchFilters, batchSize int) (deleted int64, remaining int64, err error) {
	batchSize = normalizeClearLogsBatchSize(batchSize)

	listIDs := func(limit int) ([]string, error) {
		if lister, ok := store.(logIDsByFiltersLister); ok {
			return lister.ListLogIDsByFilters(ctx, filters, limit)
		}
		result, searchErr := store.SearchLogs(ctx, filters, PaginationOptions{
			Limit:  limit,
			SortBy: "timestamp",
			Order:  "asc",
		})
		if searchErr != nil {
			return nil, searchErr
		}
		ids := make([]string, len(result.Logs))
		for i, log := range result.Logs {
			ids[i] = log.ID
		}
		return ids, nil
	}

	for range maxClearLogsBatches {
		ids, listErr := listIDs(batchSize)
		if listErr != nil {
			return deleted, 0, listErr
		}
		if len(ids) == 0 {
			reclaimDiskSpaceAfterClear(ctx, store, deleted, 0)
			return deleted, 0, nil
		}
		if deleteErr := store.DeleteLogs(ctx, ids); deleteErr != nil {
			return deleted, 0, deleteErr
		}
		deleted += int64(len(ids))
		if len(ids) < batchSize {
			reclaimDiskSpaceAfterClear(ctx, store, deleted, 0)
			return deleted, 0, nil
		}
	}

	stats, statsErr := store.GetStats(ctx, filters)
	if statsErr != nil {
		return deleted, 0, statsErr
	}
	remaining = stats.TotalRequests
	reclaimDiskSpaceAfterClear(ctx, store, deleted, remaining)
	return deleted, remaining, nil
}
