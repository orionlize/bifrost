package tables

import "time"

// AoneUserTable stores dashboard users synced from Aone OAuth2 /api/oauth2/me.
type AoneUserTable struct {
	ID            int        `gorm:"primaryKey;autoIncrement" json:"-"`
	AoneUserID    string     `gorm:"column:aone_user_id;type:varchar(255);not null;uniqueIndex" json:"id"`
	Email         string     `gorm:"type:varchar(255);index" json:"email"`
	Name          string     `gorm:"type:varchar(255)" json:"name"`
	Avatar        string     `gorm:"type:text" json:"avatar"`
	Status        string     `gorm:"type:varchar(50)" json:"status"`
	EmailVerified bool       `json:"email_verified"`
	UserCreatedAt *time.Time `gorm:"column:user_created_at" json:"created_at,omitempty"`

	DingtalkJSON    string `gorm:"column:dingtalk_json;type:text" json:"-"`
	ApplicationJSON string `gorm:"column:application_json;type:text" json:"-"`

	DepartmentNames string `gorm:"column:department_names;type:text" json:"department_names"`
	DisplayName     string `gorm:"column:display_name;type:varchar(255);index" json:"display_name"`
	DisplayAvatar   string `gorm:"column:display_avatar;type:text" json:"display_avatar"`
	JobTitle        string `gorm:"column:job_title;type:varchar(255)" json:"job_title,omitempty"`

	VirtualKeyID *string `gorm:"column:virtual_key_id;type:varchar(255);index" json:"virtual_key_id,omitempty"`
	IsDisabled   bool    `gorm:"column:is_disabled;not null;default:false;index" json:"is_disabled"`

	LastLoginAt time.Time `gorm:"index;not null" json:"last_login_at"`
	LoginCount  int64     `gorm:"not null;default:0" json:"login_count"`
	CreatedAt   time.Time `gorm:"index;not null" json:"record_created_at,omitempty"`
	UpdatedAt   time.Time `gorm:"index;not null" json:"updated_at,omitempty"`
}

// TableName sets the table name for the model.
func (AoneUserTable) TableName() string { return "aone_users" }
