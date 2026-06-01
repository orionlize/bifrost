package handlers

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/plugins/logging"
)

func (h *LoggingHandler) aoneOAuthEnabled(ctx context.Context) bool {
	if h.config == nil || h.config.ConfigStore == nil {
		return false
	}
	authConfig, err := h.config.ConfigStore.GetAuthConfig(ctx)
	if err != nil || authConfig == nil {
		return false
	}
	return aoneOAuthEnabled(authConfig)
}

func (h *LoggingHandler) getAoneUserDimensionRankings(ctx context.Context, filters logstore.SearchFilters) (*logstore.DimensionRankingResult, error) {
	if h.config == nil || h.config.ConfigStore == nil {
		return &logstore.DimensionRankingResult{
			Rankings:  []logstore.DimensionRankingWithTrend{},
			Dimension: logstore.RankingDimensionUser,
		}, nil
	}

	users, _, err := h.config.ConfigStore.GetAoneUsersPaginated(ctx, configstore.AoneUsersQueryParams{
		Limit:  10000,
		Offset: 0,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list aone users for rankings: %w", err)
	}

	selectedUserIDs := make(map[string]struct{}, len(filters.UserIDs))
	for _, id := range filters.UserIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			selectedUserIDs[id] = struct{}{}
		}
	}

	type rankedUser struct {
		user tables.AoneUserTable
		vkID string
	}

	ranked := make([]rankedUser, 0, len(users))
	virtualKeyIDs := make([]string, 0, len(users))
	for i := range users {
		user := users[i]
		if user.IsDisabled {
			continue
		}
		if len(selectedUserIDs) > 0 {
			if _, ok := selectedUserIDs[user.AoneUserID]; !ok {
				continue
			}
		}
		vkID := ""
		if user.VirtualKeyID != nil {
			vkID = strings.TrimSpace(*user.VirtualKeyID)
		}
		if vkID != "" {
			virtualKeyIDs = append(virtualKeyIDs, vkID)
		}
		ranked = append(ranked, rankedUser{user: user, vkID: vkID})
	}

	usageFilters := filters
	usageFilters.UserIDs = nil

	currentUsage, prevUsage, err := h.logManager.GetVirtualKeyUsageRankings(ctx, &usageFilters, virtualKeyIDs)
	if err != nil {
		return nil, err
	}

	rankings := make([]logstore.DimensionRankingWithTrend, 0, len(ranked))
	for _, item := range ranked {
		var current logstore.VirtualKeyUsageAggregate
		if item.vkID != "" {
			current = currentUsage[item.vkID]
		}
		entry := logstore.DimensionRankingEntry{
			ID:            item.user.AoneUserID,
			Name:          configstore.AoneUserRankingDisplayName(&item.user),
			TotalRequests: current.TotalRequests,
			TotalTokens:   current.TotalTokens,
			TotalCost:     current.TotalCost,
		}

		var trend logstore.DimensionRankingTrend
		if item.vkID != "" {
			if prev, ok := prevUsage[item.vkID]; ok && prev.TotalRequests > 0 {
				trend.HasPreviousPeriod = true
				trend.RequestsTrend = pctChange(float64(prev.TotalRequests), float64(current.TotalRequests))
				trend.TokensTrend = pctChange(float64(prev.TotalTokens), float64(current.TotalTokens))
				trend.CostTrend = pctChange(prev.TotalCost, current.TotalCost)
			}
		}

		rankings = append(rankings, logstore.DimensionRankingWithTrend{
			DimensionRankingEntry: entry,
			Trend:                 trend,
		})
	}

	sort.Slice(rankings, func(i, j int) bool {
		if rankings[i].TotalRequests == rankings[j].TotalRequests {
			return rankings[i].Name < rankings[j].Name
		}
		return rankings[i].TotalRequests > rankings[j].TotalRequests
	})

	return &logstore.DimensionRankingResult{
		Rankings:  rankings,
		Dimension: logstore.RankingDimensionUser,
	}, nil
}

func (h *LoggingHandler) getAoneUsersFilterPairs(ctx context.Context, limit int, query string) ([]logging.KeyPair, error) {
	if h.config == nil || h.config.ConfigStore == nil {
		return nil, nil
	}
	users, _, err := h.config.ConfigStore.GetAoneUsersPaginated(ctx, configstore.AoneUsersQueryParams{
		Limit:  limit,
		Offset: 0,
		Search: query,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list aone users for filters: %w", err)
	}

	pairs := make([]logging.KeyPair, 0, len(users))
	for i := range users {
		user := users[i]
		if user.IsDisabled {
			continue
		}
		pairs = append(pairs, logging.KeyPair{
			ID:   user.AoneUserID,
			Name: configstore.AoneUserRankingDisplayName(&user),
		})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].Name < pairs[j].Name
	})
	if len(pairs) > limit {
		pairs = pairs[:limit]
	}
	return logging.EnsureLocalAdminUserPair(pairs, query), nil
}

func pctChange(old, new float64) float64 {
	if old == 0 {
		return 0
	}
	return ((new - old) / old) * 100
}
