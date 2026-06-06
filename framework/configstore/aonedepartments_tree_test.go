package configstore

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBuildDepartmentTreeFromUsersUsesChainPaths(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&tables.AoneUserTable{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	dingtalkJSON := `{
		"profile": {"name": "张强", "title": "WEB开发工程师"},
		"departments": [{
			"name": "研发组",
			"chain": [
				{"name": "杭州新麦科技有限公司", "deptId": 1, "parentId": 0},
				{"name": "研发中心", "deptId": 234308, "parentId": 1},
				{"name": "数智化团队", "deptId": 1062379544, "parentId": 234308},
				{"name": "研发组", "deptId": 1062138649, "parentId": 1062379544}
			],
			"deptId": 1062138649,
			"fullPath": "研发中心 / 数智化团队 / 研发组"
		}],
		"syncedAt": "2026-03-28T04:03:23.689Z"
	}`

	now := time.Now()
	if err := db.Create(&tables.AoneUserTable{
		AoneUserID:   "user-1",
		DingtalkJSON: dingtalkJSON,
		LastLoginAt:  now,
		CreatedAt:    now,
		UpdatedAt:    now,
	}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	store := &RDBConfigStore{}
	store.db.Store(db)
	tree, err := store.buildDepartmentTreeFromUsers(context.Background())
	if err != nil {
		t.Fatalf("build tree: %v", err)
	}
	if len(tree) != 1 {
		t.Fatalf("roots = %d", len(tree))
	}
	if tree[0].Name != "杭州新麦科技有限公司" {
		t.Fatalf("root = %+v", tree[0])
	}
	if len(tree[0].Children) != 1 || tree[0].Children[0].Name != "研发中心" {
		t.Fatalf("level2 = %+v", tree[0].Children)
	}
	leaf := tree[0].Children[0].Children[0].Children[0]
	if leaf.DeptID != 1062138649 || leaf.FullPath != "杭州新麦科技有限公司 / 研发中心 / 数智化团队 / 研发组" {
		t.Fatalf("leaf = %+v", leaf)
	}
}
