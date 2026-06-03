package lib

import (
	"testing"

	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyProductionDefaults_OutsideProduction(t *testing.T) {
	t.Setenv(productionEnvKey, "development")

	var configData ConfigData
	applyProductionDefaults(&configData)

	assert.Nil(t, configData.VectorStoreConfig)
}

func TestApplyProductionDefaults_InProduction(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)

	var configData ConfigData
	applyProductionDefaults(&configData)

	require.NotNil(t, configData.VectorStoreConfig)
	assert.True(t, configData.VectorStoreConfig.Enabled)
	assert.Equal(t, vectorstore.VectorStoreTypeRedis, configData.VectorStoreConfig.Type)

	redisConfig, ok := configData.VectorStoreConfig.Config.(vectorstore.RedisConfig)
	require.True(t, ok)
	assert.Equal(t, "ai-redis-ytykne:6379", redisConfig.Addr.GetValue())
	assert.Equal(t, "default", redisConfig.Username.GetValue())
}

func TestApplyProductionDefaults_RespectsExistingConfig(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)

	configData := ConfigData{
		VectorStoreConfig: &vectorstore.Config{
			Enabled: true,
			Type:    vectorstore.VectorStoreTypeWeaviate,
		},
	}
	applyProductionDefaults(&configData)

	assert.Equal(t, vectorstore.VectorStoreTypeWeaviate, configData.VectorStoreConfig.Type)
}
