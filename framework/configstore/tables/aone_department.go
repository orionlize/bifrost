package tables

import "time"

// AoneDepartmentTable stores departments synced from Aone OAuth organization data.
type AoneDepartmentTable struct {
	DeptID       int        `gorm:"primaryKey;column:dept_id" json:"dept_id"`
	Name         string     `gorm:"type:varchar(255);not null" json:"name"`
	ParentDeptID *int       `gorm:"column:parent_dept_id;index" json:"parent_dept_id,omitempty"`
	FullPath     string     `gorm:"column:full_path;type:text" json:"full_path"`
	SortOrder    int        `gorm:"column:sort_order;not null;default:0" json:"sort_order"`
	CreatedAt    time.Time  `gorm:"index;not null" json:"created_at"`
	UpdatedAt    time.Time  `gorm:"index;not null" json:"updated_at"`
}

// TableName sets the table name for AoneDepartmentTable.
func (AoneDepartmentTable) TableName() string { return "aone_departments" }

// AoneUserDepartmentTable links Aone users to one or more departments.
type AoneUserDepartmentTable struct {
	ID         uint      `gorm:"primaryKey;autoIncrement" json:"-"`
	AoneUserID string    `gorm:"column:aone_user_id;type:varchar(255);not null;uniqueIndex:idx_aone_user_dept" json:"aone_user_id"`
	DeptID     int       `gorm:"column:dept_id;not null;uniqueIndex:idx_aone_user_dept;index" json:"dept_id"`
	CreatedAt  time.Time `gorm:"index;not null" json:"created_at"`
}

// TableName sets the table name for AoneUserDepartmentTable.
func (AoneUserDepartmentTable) TableName() string { return "aone_user_departments" }
