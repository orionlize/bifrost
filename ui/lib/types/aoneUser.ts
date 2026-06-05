export interface AoneUserDepartment {
	deptId: number;
	name: string;
	fullPath?: string;
	pathDeptIds?: number[];
	chain?: Array<{
		name: string;
		deptId: number;
		parentId: number;
	}>;
	isLeader?: boolean;
}

export interface AoneDepartmentTreeNode {
	dept_id: number;
	name: string;
	full_path?: string;
	parent_dept_id?: number;
	children?: AoneDepartmentTreeNode[];
}

export interface AoneDepartmentTreeResponse {
	departments: AoneDepartmentTreeNode[];
}

export interface AoneDepartmentListItem {
	dept_id: number;
	name: string;
	parent_dept_id?: number;
	full_path?: string;
}

export interface AoneDepartmentsListResponse {
	departments: AoneDepartmentListItem[];
	total_count: number;
	limit: number;
	offset: number;
}

export interface AoneDepartmentsQueryParams {
	limit?: number;
	offset?: number;
	search?: string;
}

export interface AoneUserListItem {
	id: string;
	email: string;
	name: string;
	avatar: string;
	display_name: string;
	display_avatar: string;
	status: string;
	email_verified: boolean;
	is_disabled?: boolean;
	department_names: string;
	job_title?: string;
	departments?: AoneUserDepartment[];
	last_login_at: string;
	login_count: number;
	created_at?: string;
}

export interface AoneUsersListResponse {
	users: AoneUserListItem[];
	total_count: number;
	limit: number;
	offset: number;
}

export interface AoneDingtalkProfile {
	name: string;
	title: string;
	mobile: string;
	workPlace: string;
	jobNumber: string;
	hiredDate: string;
	telephone: string;
	orgEmail: string;
	avatar: string;
}

export interface AoneDingtalkInfo {
	profile: AoneDingtalkProfile;
	departments: AoneUserDepartment[];
	syncedAt: string;
}

export interface AoneApplicationInfo {
	id: string;
	name: string;
	logo: string;
}

export interface AoneUserDetailResponse {
	user: {
		id: string;
		email: string;
		name: string;
		avatar: string;
		status: string;
		email_verified: boolean;
		created_at?: string;
		display_name?: string;
		display_avatar?: string;
	};
	dingtalk?: AoneDingtalkInfo;
	application?: AoneApplicationInfo;
	api_key?: string;
	api_key_active?: boolean;
	is_disabled?: boolean;
	last_login_at: string;
	login_count: number;
	record_created_at: string;
	updated_at: string;
}

export interface AoneUsersQueryParams {
	limit?: number;
	offset?: number;
	search?: string;
}

export interface UpdateAoneUserRequest {
	is_disabled: boolean;
}