package configstore

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/aoneoauth"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

// AoneDepartmentsQueryParams holds pagination and search for department queries.
type AoneDepartmentsQueryParams struct {
	Limit  int
	Offset int
	Search string
}

// SyncAoneOrgFromLogin upserts organization departments and user membership from OAuth /me data.
func (s *RDBConfigStore) SyncAoneOrgFromLogin(ctx context.Context, aoneUserID string, me *aoneoauth.MeResponse) error {
	if me == nil || aoneUserID == "" {
		return nil
	}

	return s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		deptByID := map[int]tables.AoneDepartmentTable{}
		var userPaths [][]aoneoauth.DingtalkDepartment

		if me.Organization != nil {
			for _, dept := range me.Organization.Departments {
				if dept.DeptID <= 0 || strings.TrimSpace(dept.Name) == "" {
					continue
				}
				var parentID *int
				if dept.ParentDeptID > 0 {
					parentID = &dept.ParentDeptID
				}
				deptByID[dept.DeptID] = tables.AoneDepartmentTable{
					DeptID:       dept.DeptID,
					Name:         strings.TrimSpace(dept.Name),
					ParentDeptID: parentID,
					SortOrder:    dept.Order,
					UpdatedAt:    now,
				}
			}
		}

		if me.Dingtalk != nil {
			userPaths = me.Dingtalk.DepartmentPaths.Paths
			if len(userPaths) == 0 && len(me.Dingtalk.Departments) > 0 {
				if data, err := json.Marshal(me.Dingtalk.Departments); err == nil {
					userPaths, _ = aoneoauth.ParseDepartmentPaths(data)
				}
			}
			pathDepartments := aoneoauth.DepartmentsForOrgSync(me.Organization, userPaths)
			for i, dept := range pathDepartments {
				if dept.DeptID <= 0 || strings.TrimSpace(dept.Name) == "" {
					continue
				}
				var parentID *int
				if dept.ParentDeptID != nil {
					parentID = dept.ParentDeptID
				} else if i > 0 && pathDepartments[i-1].DeptID > 0 {
					prev := pathDepartments[i-1].DeptID
					parentID = &prev
				}
				if existing, ok := deptByID[dept.DeptID]; ok {
					existing.Name = strings.TrimSpace(dept.Name)
					if parentID != nil {
						existing.ParentDeptID = parentID
					}
					deptByID[dept.DeptID] = existing
					continue
				}
				deptByID[dept.DeptID] = tables.AoneDepartmentTable{
					DeptID:       dept.DeptID,
					Name:         strings.TrimSpace(dept.Name),
					ParentDeptID: parentID,
					UpdatedAt:    now,
				}
			}
		}

		for deptID, dept := range deptByID {
			var existing tables.AoneDepartmentTable
			err := tx.Where("dept_id = ?", deptID).First(&existing).Error
			if err == gorm.ErrRecordNotFound {
				dept.CreatedAt = now
				if err := tx.Create(&dept).Error; err != nil {
					return fmt.Errorf("create department %d: %w", deptID, err)
				}
				continue
			}
			if err != nil {
				return err
			}
			existing.Name = dept.Name
			if dept.ParentDeptID != nil {
				existing.ParentDeptID = dept.ParentDeptID
			}
			existing.SortOrder = dept.SortOrder
			existing.UpdatedAt = now
			if err := tx.Save(&existing).Error; err != nil {
				return fmt.Errorf("update department %d: %w", deptID, err)
			}
		}

		if err := s.recomputeAoneDepartmentPathsTx(ctx, tx); err != nil {
			return err
		}

		if err := s.refreshAoneUserDepartmentPathsTx(ctx, tx, aoneUserID); err != nil {
			return err
		}

		if me.Dingtalk == nil || (len(userPaths) == 0 && len(me.Dingtalk.Departments) == 0) {
			return nil
		}

		deptIDs := aoneoauth.AllDepartmentPathDeptIDs(userPaths)
		if len(deptIDs) == 0 {
			deptIDs = aoneoauth.DepartmentPathChainDeptIDs(me.Dingtalk.Departments)
		}
		if len(deptIDs) == 0 {
			return nil
		}

		if err := tx.Where("aone_user_id = ?", aoneUserID).Delete(&tables.AoneUserDepartmentTable{}).Error; err != nil {
			return err
		}

		rows := make([]tables.AoneUserDepartmentTable, 0, len(deptIDs))
		for _, deptID := range deptIDs {
			rows = append(rows, tables.AoneUserDepartmentTable{
				AoneUserID: aoneUserID,
				DeptID:     deptID,
				CreatedAt:  now,
			})
		}
		return tx.Create(&rows).Error
	})
}

func (s *RDBConfigStore) recomputeAoneDepartmentPathsTx(ctx context.Context, tx *gorm.DB) error {
	var departments []tables.AoneDepartmentTable
	if err := tx.WithContext(ctx).Order("sort_order ASC, dept_id ASC").Find(&departments).Error; err != nil {
		return err
	}
	if len(departments) == 0 {
		return nil
	}

	byID := make(map[int]tables.AoneDepartmentTable, len(departments))
	for i := range departments {
		byID[departments[i].DeptID] = departments[i]
	}

	pathFor := func(deptID int) string {
		parts := make([]string, 0, 4)
		seen := map[int]struct{}{}
		currentID := deptID
		for i := 0; i < 32; i++ {
			if _, ok := seen[currentID]; ok {
				break
			}
			seen[currentID] = struct{}{}
			dept, ok := byID[currentID]
			if !ok {
				break
			}
			if dept.Name != "" {
				parts = append([]string{dept.Name}, parts...)
			}
			if dept.ParentDeptID == nil || *dept.ParentDeptID <= 0 {
				break
			}
			currentID = *dept.ParentDeptID
		}
		return strings.Join(parts, " / ")
	}

	for i := range departments {
		fullPath := pathFor(departments[i].DeptID)
		if departments[i].FullPath == fullPath {
			continue
		}
		if err := tx.Model(&departments[i]).Update("full_path", fullPath).Error; err != nil {
			return err
		}
	}
	return nil
}

// GetAoneDepartmentsPaginated returns departments ordered by full path.
func (s *RDBConfigStore) GetAoneDepartmentsPaginated(ctx context.Context, params AoneDepartmentsQueryParams) ([]tables.AoneDepartmentTable, int64, error) {
	baseQuery := s.DB().WithContext(ctx).Model(&tables.AoneDepartmentTable{})
	if params.Search != "" {
		search := "%" + strings.ToLower(params.Search) + "%"
		baseQuery = baseQuery.Where("LOWER(name) LIKE ? OR LOWER(full_path) LIKE ?", search, search)
	}

	var totalCount int64
	if err := baseQuery.Count(&totalCount).Error; err != nil {
		return nil, 0, err
	}

	limit := params.Limit
	offset := params.Offset
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var departments []tables.AoneDepartmentTable
	if err := baseQuery.Order("full_path ASC, dept_id ASC").Offset(offset).Limit(limit).Find(&departments).Error; err != nil {
		return nil, 0, err
	}
	return departments, totalCount, nil
}

// GetAoneUserDepartmentIDs returns department IDs linked to an Aone user.
func (s *RDBConfigStore) GetAoneUserDepartmentIDs(ctx context.Context, aoneUserID string) ([]int, error) {
	var rows []tables.AoneUserDepartmentTable
	if err := s.DB().WithContext(ctx).
		Where("aone_user_id = ?", aoneUserID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].DeptID)
	}
	return ids, nil
}

func (s *RDBConfigStore) refreshAoneUserDepartmentPathsTx(ctx context.Context, tx *gorm.DB, aoneUserID string) error {
	var user tables.AoneUserTable
	if err := tx.WithContext(ctx).Where("aone_user_id = ?", aoneUserID).First(&user).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return err
	}
	if strings.TrimSpace(user.DingtalkJSON) == "" {
		return nil
	}

	var dingtalk aoneoauth.DingtalkInfo
	if err := json.Unmarshal([]byte(user.DingtalkJSON), &dingtalk); err != nil {
		return nil
	}

	var deptRows []tables.AoneDepartmentTable
	if err := tx.WithContext(ctx).Find(&deptRows).Error; err != nil {
		return err
	}

	paths := dingtalk.DepartmentPaths.Paths
	if len(paths) == 0 && len(dingtalk.Departments) > 0 {
		if data, err := json.Marshal(dingtalk.Departments); err == nil {
			paths, _ = aoneoauth.ParseDepartmentPaths(data)
		}
	}
	org := organizationInfoFromDepartmentRows(deptRows)
	enriched := aoneoauth.EnrichDepartmentPaths(org, paths)
	user.DepartmentNames = aoneoauth.FormatDepartmentPaths(enriched)
	user.UpdatedAt = time.Now()
	return tx.WithContext(ctx).Save(&user).Error
}

func organizationInfoFromDepartmentRows(rows []tables.AoneDepartmentTable) *aoneoauth.OrganizationInfo {
	if len(rows) == 0 {
		return nil
	}
	org := &aoneoauth.OrganizationInfo{
		Departments: make([]aoneoauth.OrganizationDepartment, 0, len(rows)),
	}
	for i := range rows {
		parentID := 0
		if rows[i].ParentDeptID != nil {
			parentID = *rows[i].ParentDeptID
		}
		org.Departments = append(org.Departments, aoneoauth.OrganizationDepartment{
			DeptID:       rows[i].DeptID,
			Name:         rows[i].Name,
			ParentDeptID: parentID,
			Order:        rows[i].SortOrder,
		})
	}
	return org
}

// AoneDepartmentTreeNode is a nested department node for tree UIs.
type AoneDepartmentTreeNode struct {
	DeptID       int                      `json:"dept_id"`
	Name         string                   `json:"name"`
	FullPath     string                   `json:"full_path,omitempty"`
	ParentDeptID *int                     `json:"parent_dept_id,omitempty"`
	Children     []AoneDepartmentTreeNode `json:"children,omitempty"`
}

// GetAoneDepartmentTree returns the organization department hierarchy derived from
// synced user department chains, falling back to the department catalog table.
func (s *RDBConfigStore) GetAoneDepartmentTree(ctx context.Context) ([]AoneDepartmentTreeNode, error) {
	if tree, err := s.buildDepartmentTreeFromUsers(ctx); err != nil {
		return nil, err
	} else if len(tree) > 0 {
		return tree, nil
	}
	return s.getAoneDepartmentTreeFromCatalog(ctx)
}

func (s *RDBConfigStore) buildDepartmentTreeFromUsers(ctx context.Context) ([]AoneDepartmentTreeNode, error) {
	var users []tables.AoneUserTable
	if err := s.DB().WithContext(ctx).
		Where("dingtalk_json IS NOT NULL AND dingtalk_json != ''").
		Find(&users).Error; err != nil {
		return nil, err
	}
	if len(users) == 0 {
		return nil, nil
	}

	type builder struct {
		deptID       int
		name         string
		parentDeptID *int
		children     map[int]*builder
	}
	nodes := map[int]*builder{}

	ensureNode := func(deptID int, name string) *builder {
		node, ok := nodes[deptID]
		if !ok {
			node = &builder{deptID: deptID, children: map[int]*builder{}}
			nodes[deptID] = node
		}
		if name != "" {
			node.name = name
		}
		return node
	}

	mergeChain := func(chain []aoneoauth.DingtalkDepartment) {
		for i, dept := range chain {
			if dept.DeptID <= 0 {
				continue
			}
			name := strings.TrimSpace(dept.Name)
			node := ensureNode(dept.DeptID, name)
			if i == 0 {
				if dept.ParentDeptID != nil && *dept.ParentDeptID > 0 {
					parentID := *dept.ParentDeptID
					node.parentDeptID = &parentID
					parent := ensureNode(parentID, "")
					parent.children[dept.DeptID] = node
				}
				continue
			}
			parentID := chain[i-1].DeptID
			if parentID <= 0 {
				continue
			}
			node.parentDeptID = &parentID
			parent := ensureNode(parentID, strings.TrimSpace(chain[i-1].Name))
			parent.children[dept.DeptID] = node
		}
	}

	for i := range users {
		var dingtalk aoneoauth.DingtalkInfo
		if err := json.Unmarshal([]byte(users[i].DingtalkJSON), &dingtalk); err != nil {
			continue
		}
		for _, path := range dingtalk.DepartmentPaths.Paths {
			mergeChain(path)
		}
	}
	if len(nodes) == 0 {
		return nil, nil
	}

	roots := make([]*builder, 0)
	for _, node := range nodes {
		if node.parentDeptID == nil || *node.parentDeptID <= 0 {
			roots = append(roots, node)
			continue
		}
		if _, ok := nodes[*node.parentDeptID]; !ok {
			roots = append(roots, node)
		}
	}

	var convert func(b *builder, parentPath string) AoneDepartmentTreeNode
	convert = func(b *builder, parentPath string) AoneDepartmentTreeNode {
		name := strings.TrimSpace(b.name)
		if name == "" {
			name = fmt.Sprintf("%d", b.deptID)
		}
		fullPath := name
		if parentPath != "" {
			fullPath = parentPath + " / " + name
		}
		childBuilders := make([]*builder, 0, len(b.children))
		for _, child := range b.children {
			childBuilders = append(childBuilders, child)
		}
		sort.Slice(childBuilders, func(i, j int) bool {
			return childBuilders[i].name < childBuilders[j].name
		})
		children := make([]AoneDepartmentTreeNode, 0, len(childBuilders))
		for _, child := range childBuilders {
			children = append(children, convert(child, fullPath))
		}
		return AoneDepartmentTreeNode{
			DeptID:       b.deptID,
			Name:         name,
			FullPath:     fullPath,
			ParentDeptID: b.parentDeptID,
			Children:     children,
		}
	}

	seenRoots := map[int]struct{}{}
	result := make([]AoneDepartmentTreeNode, 0, len(roots))
	for _, root := range roots {
		if _, ok := seenRoots[root.deptID]; ok {
			continue
		}
		seenRoots[root.deptID] = struct{}{}
		result = append(result, convert(root, ""))
	}
	sortAoneDepartmentTreeNodes(result)
	return result, nil
}

func (s *RDBConfigStore) getAoneDepartmentTreeFromCatalog(ctx context.Context) ([]AoneDepartmentTreeNode, error) {
	var departments []tables.AoneDepartmentTable
	if err := s.DB().WithContext(ctx).Order("sort_order ASC, dept_id ASC").Find(&departments).Error; err != nil {
		return nil, err
	}
	if len(departments) == 0 {
		return []AoneDepartmentTreeNode{}, nil
	}

	nodes := make(map[int]*AoneDepartmentTreeNode, len(departments))
	roots := make([]*AoneDepartmentTreeNode, 0)
	for i := range departments {
		node := &AoneDepartmentTreeNode{
			DeptID:       departments[i].DeptID,
			Name:         departments[i].Name,
			FullPath:     departments[i].FullPath,
			ParentDeptID: departments[i].ParentDeptID,
			Children:     []AoneDepartmentTreeNode{},
		}
		nodes[departments[i].DeptID] = node
	}
	for i := range departments {
		node := nodes[departments[i].DeptID]
		if departments[i].ParentDeptID == nil || *departments[i].ParentDeptID <= 0 {
			roots = append(roots, node)
			continue
		}
		parent := nodes[*departments[i].ParentDeptID]
		if parent == nil {
			roots = append(roots, node)
			continue
		}
		parent.Children = append(parent.Children, *node)
	}

	result := make([]AoneDepartmentTreeNode, 0, len(roots))
	for _, root := range roots {
		result = append(result, *root)
	}
	sortAoneDepartmentTreeNodes(result)
	return result, nil
}

func sortAoneDepartmentTreeNodes(nodes []AoneDepartmentTreeNode) {
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Name < nodes[j].Name
	})
	for i := range nodes {
		if len(nodes[i].Children) > 0 {
			sortAoneDepartmentTreeNodes(nodes[i].Children)
		}
	}
}

// ExpandAoneUserDepartmentTargetIDs returns all department ids in the user's hierarchy closure.
func (s *RDBConfigStore) ExpandAoneUserDepartmentTargetIDs(ctx context.Context, aoneUserID string) ([]string, error) {
	deptIDs, err := s.GetAoneUserDepartmentIDs(ctx, aoneUserID)
	if err != nil {
		return nil, err
	}
	if len(deptIDs) == 0 {
		user, userErr := s.GetAoneUserByAoneID(ctx, aoneUserID)
		if userErr == nil && user != nil {
			deptIDs = decodeAoneUserDepartmentIDsFromDingtalkJSON(user.DingtalkJSON)
		}
	}
	if len(deptIDs) == 0 {
		return nil, nil
	}

	var departments []tables.AoneDepartmentTable
	if err := s.DB().WithContext(ctx).Find(&departments).Error; err != nil {
		return nil, err
	}
	org := organizationInfoFromDepartmentRows(departments)
	index := aoneoauth.BuildOrganizationDepartmentIndex(org)

	seen := map[int]struct{}{}
	targets := make([]string, 0)
	for _, deptID := range deptIDs {
		_, pathIDs := aoneoauth.ResolveDepartmentPath(deptID, index)
		if len(pathIDs) == 0 {
			pathIDs = []int{deptID}
		}
		for _, id := range pathIDs {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			targets = append(targets, fmt.Sprintf("%d", id))
		}
	}
	return targets, nil
}
func decodeAoneUserDepartmentIDsFromDingtalkJSON(dingtalkJSON string) []int {
	if dingtalkJSON == "" {
		return nil
	}
	var dingtalk aoneoauth.DingtalkInfo
	if err := json.Unmarshal([]byte(dingtalkJSON), &dingtalk); err != nil {
		return nil
	}
	paths := dingtalk.DepartmentPaths.Paths
	if len(paths) == 0 && len(dingtalk.Departments) > 0 {
		if data, err := json.Marshal(dingtalk.Departments); err == nil {
			paths, _ = aoneoauth.ParseDepartmentPaths(data)
		}
	}
	if len(paths) > 0 {
		return aoneoauth.AllDepartmentPathDeptIDs(paths)
	}
	ids := make([]int, 0, len(dingtalk.Departments))
	for _, dept := range dingtalk.Departments {
		if len(dept.PathDeptIDs) > 0 {
			ids = append(ids, dept.PathDeptIDs...)
			continue
		}
		if dept.DeptID > 0 {
			ids = append(ids, dept.DeptID)
		}
	}
	return ids
}
