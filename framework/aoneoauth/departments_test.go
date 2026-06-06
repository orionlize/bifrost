package aoneoauth

import (
	"encoding/json"
	"testing"
)

func TestParseDepartmentPathsMultiplePaths(t *testing.T) {
	raw := `[
		[
			{ "deptId": 1, "name": "根部门" },
			{ "deptId": 123, "name": "技术部" }
		],
		[
			{ "deptId": 1, "name": "根部门" },
			{ "deptId": 456, "name": "产品部" }
		]
	]`
	paths, err := ParseDepartmentPaths([]byte(raw))
	if err != nil {
		t.Fatalf("parse paths: %v", err)
	}
	if len(paths) != 2 {
		t.Fatalf("expected 2 paths, got %d", len(paths))
	}

	enriched := EnrichDepartmentPaths(nil, paths)
	if len(enriched) != 2 {
		t.Fatalf("expected 2 enriched departments, got %d", len(enriched))
	}
	if enriched[0].FullPath != "根部门 / 技术部" {
		t.Fatalf("path1 = %q", enriched[0].FullPath)
	}
	if enriched[1].FullPath != "根部门 / 产品部" {
		t.Fatalf("path2 = %q", enriched[1].FullPath)
	}
	if got := FormatDepartmentPaths(enriched); got != "根部门 / 技术部; 根部门 / 产品部" {
		t.Fatalf("format = %q", got)
	}
}

func TestParseDepartmentPathsSinglePath(t *testing.T) {
	raw := `[
		{ "deptId": 1, "name": "根部门" },
		{ "deptId": 123, "name": "技术部" }
	]`
	paths, err := ParseDepartmentPaths([]byte(raw))
	if err != nil {
		t.Fatalf("parse paths: %v", err)
	}
	if len(paths) != 1 {
		t.Fatalf("expected 1 path, got %d", len(paths))
	}
	enriched := EnrichDepartmentPaths(nil, paths)
	if enriched[0].FullPath != "根部门 / 技术部" {
		t.Fatalf("fullPath = %q", enriched[0].FullPath)
	}
}

func TestDingtalkInfoUnmarshalMultiplePaths(t *testing.T) {
	payload := `{
		"profile": { "name": "张三", "title": "工程师" },
		"departments": [
			[
				{ "deptId": 1, "name": "根部门" },
				{ "deptId": 123, "name": "技术部" }
			],
			[
				{ "deptId": 1, "name": "根部门" },
				{ "deptId": 456, "name": "产品部" }
			]
		],
		"syncedAt": "2024-01-01T00:00:00.000Z"
	}`
	var dingtalk DingtalkInfo
	if err := json.Unmarshal([]byte(payload), &dingtalk); err != nil {
		t.Fatalf("unmarshal dingtalk: %v", err)
	}
	if len(dingtalk.DepartmentPaths.Paths) != 2 {
		t.Fatalf("expected 2 raw paths, got %d", len(dingtalk.DepartmentPaths.Paths))
	}
}

func TestParseDepartmentAssignmentsWithChain(t *testing.T) {
	raw := `[{
		"name": "研发组",
		"chain": [
			{"name": "杭州新麦科技有限公司", "deptId": 1, "parentId": 0},
			{"name": "研发中心", "deptId": 234308, "parentId": 1},
			{"name": "数智化团队", "deptId": 1062379544, "parentId": 234308},
			{"name": "研发组", "deptId": 1062138649, "parentId": 1062379544}
		],
		"deptId": 1062138649,
		"fullPath": "研发中心 / 数智化团队 / 研发组",
		"isLeader": false
	}]`

	assignments, paths, err := parseDepartmentsJSON([]byte(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(assignments) != 1 {
		t.Fatalf("assignments = %d", len(assignments))
	}
	if got := assignments[0].FullPath; got != "研发中心 / 数智化团队 / 研发组" {
		t.Fatalf("fullPath = %q", got)
	}
	if len(paths) != 1 || len(paths[0]) != 4 {
		t.Fatalf("paths = %+v", paths)
	}
	if paths[0][0].Name != "杭州新麦科技有限公司" || paths[0][3].DeptID != 1062138649 {
		t.Fatalf("chain = %+v", paths[0])
	}
	if got := FormatDepartmentAssignments(assignments); got != "研发中心 / 数智化团队 / 研发组" {
		t.Fatalf("format = %q", got)
	}

	var dingtalk DingtalkInfo
	payload := `{
		"profile": {"name": "张强", "title": "WEB开发工程师"},
		"departments": ` + raw + `,
		"syncedAt": "2026-03-28T04:03:23.689Z"
	}`
	if err := json.Unmarshal([]byte(payload), &dingtalk); err != nil {
		t.Fatalf("unmarshal dingtalk: %v", err)
	}
	if len(dingtalk.DepartmentPaths.Paths) != 1 || len(dingtalk.DepartmentPaths.Paths[0]) != 4 {
		t.Fatalf("dingtalk paths = %+v", dingtalk.DepartmentPaths.Paths)
	}
}

func TestDingtalkInfoMarshalWireFormatSinglePath(t *testing.T) {
	dingtalk := DingtalkInfo{
		Profile: DingtalkProfile{Name: "张三", Title: "工程师"},
		DepartmentPaths: DingtalkDepartmentPaths{Paths: [][]DingtalkDepartment{
			{
				{DeptID: 1, Name: "根部门"},
				{DeptID: 123, Name: "技术部"},
			},
		}},
		SyncedAt: "2024-01-01T00:00:00.000Z",
	}
	data, err := json.Marshal(dingtalk)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	var chain []DingtalkDepartment
	if err := json.Unmarshal(payload["departments"], &chain); err != nil {
		t.Fatalf("unmarshal departments: %v", err)
	}
	if len(chain) != 2 || chain[0].Name != "根部门" || chain[1].Name != "技术部" {
		t.Fatalf("wire chain = %+v", chain)
	}
	var roundTrip DingtalkInfo
	if err := json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatalf("unmarshal round trip: %v", err)
	}
	if len(roundTrip.DepartmentPaths.Paths) != 1 || len(roundTrip.DepartmentPaths.Paths[0]) != 2 {
		t.Fatalf("round trip paths = %+v", roundTrip.DepartmentPaths.Paths)
	}
}

func TestAllDepartmentPathDeptIDsMultiplePaths(t *testing.T) {
	paths := [][]DingtalkDepartment{
		{
			{DeptID: 1, Name: "根部门"},
			{DeptID: 123, Name: "技术部"},
		},
		{
			{DeptID: 1, Name: "根部门"},
			{DeptID: 456, Name: "产品部"},
		},
	}
	ids := AllDepartmentPathDeptIDs(paths)
	if len(ids) != 3 {
		t.Fatalf("expected 3 unique ids, got %v", ids)
	}
}

func TestEnrichDingtalkDepartmentsFullPath(t *testing.T) {
	org := &OrganizationInfo{
		Departments: []OrganizationDepartment{
			{DeptID: 1, Name: "根部门", ParentDeptID: 0},
			{DeptID: 2, Name: "技术部", ParentDeptID: 1},
			{DeptID: 3, Name: "后端组", ParentDeptID: 2},
		},
	}
	departments := []DingtalkDepartment{
		{DeptID: 3, Name: "后端组"},
	}

	enriched := EnrichDingtalkDepartments(org, departments)
	if len(enriched) != 1 {
		t.Fatalf("expected 1 department, got %d", len(enriched))
	}
	if enriched[0].FullPath != "根部门 / 技术部 / 后端组" {
		t.Fatalf("fullPath = %q", enriched[0].FullPath)
	}
}
