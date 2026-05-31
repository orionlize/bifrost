package logstore

import (
	"context"
	"fmt"
)

func (s *RDBLogStore) reclaimDiskSpace(ctx context.Context) error {
	if s.db.Dialector.Name() != "sqlite" {
		return nil
	}

	sqlDB, err := s.db.DB()
	if err != nil {
		return fmt.Errorf("get sql db: %w", err)
	}

	if _, err := sqlDB.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return fmt.Errorf("wal checkpoint: %w", err)
	}
	if _, err := sqlDB.ExecContext(ctx, "VACUUM"); err != nil {
		return fmt.Errorf("vacuum: %w", err)
	}
	return nil
}

func reclaimDiskSpaceAfterClear(ctx context.Context, store LogStore, deleted int64, remaining int64) {
	if deleted <= 0 || remaining > 0 {
		return
	}

	switch s := store.(type) {
	case *RDBLogStore:
		if err := s.reclaimDiskSpace(ctx); err != nil && s.logger != nil {
			s.logger.Warn("failed to reclaim disk space after log clear: %v", err)
		}
	case *HybridLogStore:
		inner, ok := s.inner.(*RDBLogStore)
		if !ok {
			return
		}
		if err := inner.reclaimDiskSpace(ctx); err != nil && s.logger != nil {
			s.logger.Warn("failed to reclaim disk space after log clear: %v", err)
		}
	}
}
