package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

const adminEstablishTicketTTL = 30 * time.Second

type adminEstablishTicket struct {
	token     string
	expiresAt time.Time
	issuedAt  time.Time
}

// AdminEstablishTicketStore issues one-time tickets used to establish admin cookies
// via a top-level GET navigation after JSON credential validation succeeds.
type AdminEstablishTicketStore struct {
	mu      sync.Mutex
	tickets map[string]adminEstablishTicket
}

func NewAdminEstablishTicketStore() *AdminEstablishTicketStore {
	return &AdminEstablishTicketStore{
		tickets: make(map[string]adminEstablishTicket),
	}
}

func (s *AdminEstablishTicketStore) Issue(token string, expiresAt time.Time) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	ticket := hex.EncodeToString(b)
	now := time.Now()
	s.mu.Lock()
	s.tickets[ticket] = adminEstablishTicket{
		token:     token,
		expiresAt: expiresAt,
		issuedAt:  now,
	}
	s.cleanupLocked(now)
	s.mu.Unlock()
	return ticket, nil
}

func (s *AdminEstablishTicketStore) Consume(ticket string) (token string, expiresAt time.Time, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, found := s.tickets[ticket]
	if !found {
		return "", time.Time{}, false
	}
	delete(s.tickets, ticket)
	if time.Now().After(entry.issuedAt.Add(adminEstablishTicketTTL)) {
		return "", time.Time{}, false
	}
	return entry.token, entry.expiresAt, true
}

func (s *AdminEstablishTicketStore) cleanupLocked(now time.Time) {
	for ticket, entry := range s.tickets {
		if now.After(entry.issuedAt.Add(adminEstablishTicketTTL)) {
			delete(s.tickets, ticket)
		}
	}
}
