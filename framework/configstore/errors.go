package configstore

import (
	"errors"
	"fmt"
	"strings"
)

var ErrNotFound = errors.New("not found")
var ErrAlreadyExists = errors.New("already exists")
var ErrAoneUserDisabled = errors.New("aone user is disabled")

// ErrUnresolvedKeys is returned when one or more keys could not be resolved
type ErrUnresolvedKeys struct {
	Identifiers []string
}

func (e *ErrUnresolvedKeys) Error() string {
	return fmt.Sprintf("could not resolve keys: %s", strings.Join(e.Identifiers, ", "))
}
