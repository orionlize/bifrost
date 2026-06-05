package aoneoauth

import (
	"encoding/json"
	"strings"
)

type orgDepartmentIndex struct {
	byID map[int]OrganizationDepartment
}

// DingtalkDepartmentChainNode is one node in an oauth2/me department chain.
type DingtalkDepartmentChainNode struct {
	Name     string `json:"name"`
	DeptID   int    `json:"deptId"`
	ParentID int    `json:"parentId"`
}

// DingtalkDepartmentAssignment is a department membership entry from oauth2/me.
type DingtalkDepartmentAssignment struct {
	Name     string                        `json:"name"`
	DeptID   int                           `json:"deptId"`
	FullPath string                        `json:"fullPath,omitempty"`
	IsLeader bool                          `json:"isLeader,omitempty"`
	Chain    []DingtalkDepartmentChainNode `json:"chain,omitempty"`
}

// parseDepartmentsJSON parses oauth2/me departments and preserves chain assignments when present.
func parseDepartmentsJSON(raw json.RawMessage) ([]DingtalkDepartmentAssignment, [][]DingtalkDepartment, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil, nil
	}

	var assignments []DingtalkDepartmentAssignment
	if err := json.Unmarshal(raw, &assignments); err == nil && departmentAssignmentsUseChain(assignments) {
		paths, err := pathsFromDepartmentAssignments(assignments)
		if err != nil {
			return nil, nil, err
		}
		return assignments, paths, nil
	}

	paths, err := ParseDepartmentPaths(raw)
	return nil, paths, err
}

func departmentAssignmentsUseChain(assignments []DingtalkDepartmentAssignment) bool {
	for _, assignment := range assignments {
		if len(assignment.Chain) > 0 {
			return true
		}
	}
	return false
}

func pathsFromDepartmentAssignments(assignments []DingtalkDepartmentAssignment) ([][]DingtalkDepartment, error) {
	paths := make([][]DingtalkDepartment, 0, len(assignments))
	for _, assignment := range assignments {
		if len(assignment.Chain) == 0 {
			continue
		}
		path := chainNodesToPath(assignment.Chain)
		if len(path) == 0 {
			continue
		}
		leaf := path[len(path)-1]
		if assignment.FullPath != "" {
			leaf.FullPath = strings.TrimSpace(assignment.FullPath)
		} else {
			_, fullPath, _ := BuildDepartmentPathFromChain(path)
			leaf.FullPath = fullPath
		}
		pathDeptIDs := make([]int, len(path))
		for i, dept := range path {
			pathDeptIDs[i] = dept.DeptID
		}
		leaf.PathDeptIDs = pathDeptIDs
		if assignment.DeptID > 0 {
			leaf.DeptID = assignment.DeptID
		}
		if assignment.Name != "" {
			leaf.Name = strings.TrimSpace(assignment.Name)
		}
		path[len(path)-1] = leaf
		paths = append(paths, path)
	}
	return paths, nil
}

func chainNodesToPath(chain []DingtalkDepartmentChainNode) []DingtalkDepartment {
	path := make([]DingtalkDepartment, len(chain))
	for i, node := range chain {
		dept := DingtalkDepartment{
			DeptID: node.DeptID,
			Name:   strings.TrimSpace(node.Name),
		}
		if node.ParentID > 0 {
			parentID := node.ParentID
			dept.ParentDeptID = &parentID
		}
		path[i] = dept
	}
	return path
}

// FormatDepartmentAssignments joins assignment full paths for display.
func FormatDepartmentAssignments(assignments []DingtalkDepartmentAssignment) string {
	if len(assignments) == 0 {
		return ""
	}
	paths := make([]string, 0, len(assignments))
	for _, assignment := range assignments {
		if path := strings.TrimSpace(assignment.FullPath); path != "" {
			paths = append(paths, path)
			continue
		}
		if len(assignment.Chain) == 0 {
			continue
		}
		chain := chainNodesToPath(assignment.Chain)
		_, fullPath, _ := BuildDepartmentPathFromChain(chain)
		if fullPath != "" {
			paths = append(paths, fullPath)
		}
	}
	return strings.Join(paths, "; ")
}

func marshalDepartmentsWire(assignments []DingtalkDepartmentAssignment, paths [][]DingtalkDepartment) ([]byte, error) {
	if len(assignments) > 0 {
		return json.Marshal(assignments)
	}
	return MarshalDepartmentWireFormat(paths)
}

// MarshalDepartmentWireFormat serializes department paths in the Aone oauth2/me wire shape:
// single path -> [{root}, {leaf}, ...]; multiple paths -> [[...], [...]].
func MarshalDepartmentWireFormat(paths [][]DingtalkDepartment) ([]byte, error) {
	if len(paths) == 0 {
		return []byte("[]"), nil
	}
	if len(paths) == 1 {
		chain := make([]DingtalkDepartment, len(paths[0]))
		for i, dept := range paths[0] {
			chain[i] = stripDepartmentForWire(dept)
		}
		return json.Marshal(chain)
	}
	nested := make([][]DingtalkDepartment, len(paths))
	for i, path := range paths {
		nested[i] = make([]DingtalkDepartment, len(path))
		for j, dept := range path {
			nested[i][j] = stripDepartmentForWire(dept)
		}
	}
	return json.Marshal(nested)
}

func stripDepartmentForWire(dept DingtalkDepartment) DingtalkDepartment {
	out := DingtalkDepartment{
		DeptID: dept.DeptID,
		Name:   strings.TrimSpace(dept.Name),
	}
	if dept.ParentDeptID != nil {
		out.ParentDeptID = dept.ParentDeptID
	}
	return out
}

// ParseDepartmentPaths parses Aone departments JSON.
// Supported shapes:
//   - Multiple paths: [[{root},{leaf}], [{root},{other}]]
//   - Single path: [{root},{leaf}]
//   - Enriched leaves: [{deptId, name, fullPath, pathDeptIds}, ...]
func ParseDepartmentPaths(raw json.RawMessage) ([][]DingtalkDepartment, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}

	var nested [][]DingtalkDepartment
	if err := json.Unmarshal(raw, &nested); err == nil && len(nested) > 0 && len(nested[0]) > 0 {
		return nested, nil
	}

	var flat []DingtalkDepartment
	if err := json.Unmarshal(raw, &flat); err != nil {
		return nil, err
	}
	if len(flat) == 0 {
		return nil, nil
	}

	if flat[0].FullPath != "" || len(flat[0].PathDeptIDs) > 0 {
		paths := make([][]DingtalkDepartment, len(flat))
		for i, dept := range flat {
			paths[i] = []DingtalkDepartment{dept}
		}
		return paths, nil
	}

	return [][]DingtalkDepartment{flat}, nil
}

// BuildDepartmentPathFromChain joins an ordered department path into display metadata.
func BuildDepartmentPathFromChain(departments []DingtalkDepartment) (leaf DingtalkDepartment, fullPath string, pathDeptIDs []int) {
	if len(departments) == 0 {
		return DingtalkDepartment{}, "", nil
	}
	names := make([]string, 0, len(departments))
	pathDeptIDs = make([]int, 0, len(departments))
	for _, dept := range departments {
		name := strings.TrimSpace(dept.Name)
		if dept.DeptID > 0 {
			pathDeptIDs = append(pathDeptIDs, dept.DeptID)
		}
		if name != "" {
			names = append(names, name)
		}
	}
	leaf = departments[len(departments)-1]
	leaf.Name = strings.TrimSpace(leaf.Name)
	if len(names) > 0 {
		fullPath = strings.Join(names, " / ")
	}
	leaf.FullPath = fullPath
	leaf.PathDeptIDs = append([]int(nil), pathDeptIDs...)
	return leaf, fullPath, pathDeptIDs
}

// InferDepartmentPathChainParents assigns parentDeptId from an ordered root-to-leaf chain.
func InferDepartmentPathChainParents(departments []DingtalkDepartment) []DingtalkDepartment {
	if len(departments) == 0 {
		return departments
	}
	inferred := make([]DingtalkDepartment, len(departments))
	for i, dept := range departments {
		inferred[i] = dept
		if i == 0 {
			inferred[i].ParentDeptID = nil
			continue
		}
		parentID := departments[i-1].DeptID
		inferred[i].ParentDeptID = &parentID
	}
	return inferred
}

// BuildOrganizationDepartmentIndex indexes organization departments by id.
func BuildOrganizationDepartmentIndex(org *OrganizationInfo, extra ...DingtalkDepartment) orgDepartmentIndex {
	index := orgDepartmentIndex{byID: map[int]OrganizationDepartment{}}
	if org != nil {
		for _, dept := range org.Departments {
			if dept.DeptID <= 0 || strings.TrimSpace(dept.Name) == "" {
				continue
			}
			index.byID[dept.DeptID] = dept
		}
	}
	for _, dept := range extra {
		if dept.DeptID <= 0 || strings.TrimSpace(dept.Name) == "" {
			continue
		}
		if _, ok := index.byID[dept.DeptID]; ok {
			continue
		}
		parentID := 0
		if dept.ParentDeptID != nil {
			parentID = *dept.ParentDeptID
		}
		index.byID[dept.DeptID] = OrganizationDepartment{
			DeptID:       dept.DeptID,
			Name:         strings.TrimSpace(dept.Name),
			ParentDeptID: parentID,
		}
	}
	return index
}

// ResolveDepartmentPath returns the full path and ancestor dept ids for a department.
func ResolveDepartmentPath(deptID int, index orgDepartmentIndex) (fullPath string, pathDeptIDs []int) {
	if deptID <= 0 {
		return "", nil
	}
	parts := make([]string, 0, 4)
	ids := make([]int, 0, 4)
	seen := map[int]struct{}{}
	currentID := deptID
	for i := 0; i < 32; i++ {
		if _, ok := seen[currentID]; ok {
			break
		}
		seen[currentID] = struct{}{}
		dept, ok := index.byID[currentID]
		if !ok {
			break
		}
		if dept.Name != "" {
			parts = append([]string{dept.Name}, parts...)
		}
		ids = append([]int{dept.DeptID}, ids...)
		if dept.ParentDeptID <= 0 {
			break
		}
		currentID = dept.ParentDeptID
	}
	if len(parts) == 0 {
		return "", ids
	}
	return strings.Join(parts, " / "), ids
}

func enrichSingleDepartment(org *OrganizationInfo, dept DingtalkDepartment) DingtalkDepartment {
	index := BuildOrganizationDepartmentIndex(org, dept)
	enriched := dept
	fullPath, pathIDs := ResolveDepartmentPath(dept.DeptID, index)
	if fullPath != "" {
		enriched.FullPath = fullPath
	} else if strings.TrimSpace(dept.Name) != "" {
		enriched.FullPath = strings.TrimSpace(dept.Name)
	}
	if len(pathIDs) > 0 {
		enriched.PathDeptIDs = pathIDs
	} else if dept.DeptID > 0 {
		enriched.PathDeptIDs = []int{dept.DeptID}
	}
	return enriched
}

// EnrichDepartmentPaths normalizes each org path and returns one leaf entry per path.
func EnrichDepartmentPaths(org *OrganizationInfo, paths [][]DingtalkDepartment) []DingtalkDepartment {
	if len(paths) == 0 {
		return nil
	}
	enriched := make([]DingtalkDepartment, 0, len(paths))
	for _, path := range paths {
		if len(path) == 0 {
			continue
		}
		if len(path) == 1 {
			dept := path[0]
			if dept.FullPath != "" && len(dept.PathDeptIDs) > 0 {
				enriched = append(enriched, dept)
				continue
			}
			enriched = append(enriched, enrichSingleDepartment(org, dept))
			continue
		}
		leaf, _, _ := BuildDepartmentPathFromChain(path)
		if leaf.FullPath == "" {
			leaf = enrichSingleDepartment(org, leaf)
		}
		enriched = append(enriched, leaf)
	}
	return enriched
}

// EnrichDingtalkDepartments enriches a flat department list (legacy callers).
func EnrichDingtalkDepartments(org *OrganizationInfo, departments []DingtalkDepartment) []DingtalkDepartment {
	paths, err := ParseDepartmentPaths(mustMarshal(departments))
	if err != nil || len(paths) == 0 {
		return departments
	}
	return EnrichDepartmentPaths(org, paths)
}

func mustMarshal(v any) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return data
}

// AllDepartmentPathDeptIDs returns the union of dept ids across all org paths.
func AllDepartmentPathDeptIDs(paths [][]DingtalkDepartment) []int {
	seen := map[int]struct{}{}
	ids := make([]int, 0)
	for _, path := range paths {
		if len(path) == 0 {
			continue
		}
		if len(path) == 1 && (path[0].FullPath != "" || len(path[0].PathDeptIDs) > 0) {
			for _, id := range path[0].PathDeptIDs {
				if id <= 0 {
					continue
				}
				if _, ok := seen[id]; ok {
					continue
				}
				seen[id] = struct{}{}
				ids = append(ids, id)
			}
			if len(path[0].PathDeptIDs) == 0 && path[0].DeptID > 0 {
				if _, ok := seen[path[0].DeptID]; !ok {
					seen[path[0].DeptID] = struct{}{}
					ids = append(ids, path[0].DeptID)
				}
			}
			continue
		}
		if len(path) >= 2 {
			_, _, pathIDs := BuildDepartmentPathFromChain(path)
			for _, id := range pathIDs {
				if id <= 0 {
					continue
				}
				if _, ok := seen[id]; ok {
					continue
				}
				seen[id] = struct{}{}
				ids = append(ids, id)
			}
			continue
		}
		if path[0].DeptID > 0 {
			if _, ok := seen[path[0].DeptID]; !ok {
				seen[path[0].DeptID] = struct{}{}
				ids = append(ids, path[0].DeptID)
			}
		}
	}
	return ids
}

// DepartmentPathChainDeptIDs returns all dept ids from department paths.
func DepartmentPathChainDeptIDs(departments []DingtalkDepartment) []int {
	paths, err := ParseDepartmentPaths(mustMarshal(departments))
	if err != nil || len(paths) == 0 {
		return nil
	}
	return AllDepartmentPathDeptIDs(paths)
}

// FormatDepartmentPaths joins department full paths for display.
func FormatDepartmentPaths(departments []DingtalkDepartment) string {
	if len(departments) == 0 {
		return ""
	}
	paths := make([]string, 0, len(departments))
	for _, dept := range departments {
		path := strings.TrimSpace(dept.FullPath)
		if path == "" {
			path = strings.TrimSpace(dept.Name)
		}
		if path != "" {
			paths = append(paths, path)
		}
	}
	return strings.Join(paths, "; ")
}

// DepartmentsForOrgSync returns departments with inferred parents for catalog sync.
func DepartmentsForOrgSync(org *OrganizationInfo, paths [][]DingtalkDepartment) []DingtalkDepartment {
	if len(paths) == 0 {
		return nil
	}
	out := make([]DingtalkDepartment, 0)
	for _, path := range paths {
		if len(path) == 0 {
			continue
		}
		if len(path) == 1 && len(path[0].PathDeptIDs) > 1 {
			// Reconstruct chain from enriched leaf metadata when available.
			for i, deptID := range path[0].PathDeptIDs {
				name := ""
				if i == len(path[0].PathDeptIDs)-1 {
					name = path[0].Name
				}
				out = append(out, DingtalkDepartment{DeptID: deptID, Name: name})
			}
			continue
		}
		if len(path) >= 2 {
			out = append(out, InferDepartmentPathChainParents(path)...)
			continue
		}
		out = append(out, path...)
	}
	if org != nil && len(org.Departments) > 0 {
		return out
	}
	return InferDepartmentPathChainParents(out)
}

// DingtalkDepartmentPaths stores multiple root-to-leaf department paths for one user.
type DingtalkDepartmentPaths struct {
	Paths [][]DingtalkDepartment
}

func (p *DingtalkDepartmentPaths) UnmarshalJSON(data []byte) error {
	paths, err := ParseDepartmentPaths(data)
	if err != nil {
		return err
	}
	p.Paths = paths
	return nil
}

func (p DingtalkDepartmentPaths) MarshalJSON() ([]byte, error) {
	if len(p.Paths) == 0 {
		return []byte("[]"), nil
	}
	return json.Marshal(p.Paths)
}

func (p DingtalkDepartmentPaths) FlatRaw() []DingtalkDepartment {
	if len(p.Paths) == 0 {
		return nil
	}
	if len(p.Paths) == 1 {
		return append([]DingtalkDepartment(nil), p.Paths[0]...)
	}
	flat := make([]DingtalkDepartment, 0, len(p.Paths))
	for _, path := range p.Paths {
		if len(path) == 0 {
			continue
		}
		flat = append(flat, path[len(path)-1])
	}
	return flat
}
