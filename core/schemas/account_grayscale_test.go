package schemas

import "testing"

func TestKeyIsAccessibleByUser(t *testing.T) {
	enabled := true
	key := Key{
		GrayscaleEnabled: &enabled,
		GrayscaleUsers:   []string{"user-a", "user-b"},
	}

	if !key.IsAccessibleByUser("user-a") {
		t.Fatal("expected user-a to access grayscale key")
	}
	if key.IsAccessibleByUser("user-c") {
		t.Fatal("expected user-c to be denied")
	}
	if key.IsAccessibleByUser("") {
		t.Fatal("expected empty user to be denied when grayscale enabled")
	}

	key.GrayscaleEnabled = nil
	if !key.IsAccessibleByUser("anyone") {
		t.Fatal("expected open access when grayscale disabled")
	}
}

func TestKeyIsAccessibleByUser_AdminBypassesGrayscale(t *testing.T) {
	enabled := true
	key := Key{
		GrayscaleEnabled: &enabled,
		GrayscaleUsers:   []string{"user-a"},
	}

	if !key.IsAccessibleByUserForRequest(LocalAdminUserID, false) {
		t.Fatal("expected local admin user id to bypass grayscale restrictions")
	}
	if !key.IsAccessibleByUserForRequest("user-b", true) {
		t.Fatal("expected local admin session to bypass grayscale restrictions")
	}
	if key.IsAccessibleByUserForRequest("user-b", false) {
		t.Fatal("expected non-admin user to remain restricted")
	}
}
