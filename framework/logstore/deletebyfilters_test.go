package logstore

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDeleteLogsByFilters(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	store := &RDBLogStore{db: db}
	ctx := context.Background()
	now := time.Now().UTC()

	inRange := &Log{ID: "log-1", Timestamp: now, Status: "success"}
	outOfRange := &Log{ID: "log-2", Timestamp: now.Add(-48 * time.Hour), Status: "success"}
	require.NoError(t, store.Create(ctx, inRange))
	require.NoError(t, store.Create(ctx, outOfRange))

	start := now.Add(-time.Hour)
	end := now.Add(time.Hour)
	filters := SearchFilters{
		StartTime: &start,
		EndTime:   &end,
	}

	deleted, remaining, err := store.DeleteLogsByFilters(ctx, filters, 100)
	require.NoError(t, err)
	require.Equal(t, int64(1), deleted)
	require.Equal(t, int64(0), remaining)

	_, err = store.FindByID(ctx, "log-1")
	require.Error(t, err)
	_, err = store.FindByID(ctx, "log-2")
	require.NoError(t, err)
}

func TestDeleteLogsByFiltersEmptyFiltersDeletesAll(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	store := &RDBLogStore{db: db}
	ctx := context.Background()
	now := time.Now().UTC()

	require.NoError(t, store.Create(ctx, &Log{ID: "log-1", Timestamp: now, Status: "success"}))
	require.NoError(t, store.Create(ctx, &Log{ID: "log-2", Timestamp: now, Status: "success"}))

	deleted, remaining, err := store.DeleteLogsByFilters(ctx, SearchFilters{}, 100)
	require.NoError(t, err)
	require.Equal(t, int64(2), deleted)
	require.Equal(t, int64(0), remaining)

	hasLogs, err := store.HasLogs(ctx)
	require.NoError(t, err)
	require.False(t, hasLogs)
}

func dbTotalSize(dbPath string) int64 {
	var total int64
	for _, suffix := range []string{"", "-wal", "-shm"} {
		info, err := os.Stat(dbPath + suffix)
		if err != nil {
			continue
		}
		total += info.Size()
	}
	return total
}

func TestReclaimDiskSpaceShrinksSQLiteFile(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "logs.db")

	dsn := dbPath + "?_journal_mode=WAL&_synchronous=NORMAL"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	store := &RDBLogStore{db: db}
	ctx := context.Background()
	now := time.Now().UTC()

	largePayload := make([]byte, 256*1024)
	for i := range largePayload {
		largePayload[i] = 'x'
	}

	for i := range 20 {
		require.NoError(t, store.Create(ctx, &Log{
			ID:           fmt.Sprintf("log-%d", i),
			Timestamp:    now,
			Status:       "success",
			InputHistory: string(largePayload),
		}))
	}

	beforeDelete := dbTotalSize(dbPath)

	deleted, remaining, err := store.DeleteLogsByFilters(ctx, SearchFilters{}, 100)
	require.NoError(t, err)
	require.Equal(t, int64(20), deleted)
	require.Equal(t, int64(0), remaining)

	afterDelete := dbTotalSize(dbPath)
	require.Less(t, afterDelete, beforeDelete)
}
