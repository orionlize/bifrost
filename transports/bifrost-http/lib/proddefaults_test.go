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

func TestApplyProductionDefaults_InProductionWithoutRedisEnv(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "")

	var configData ConfigData
	applyProductionDefaults(&configData)

	assert.Nil(t, configData.VectorStoreConfig)
}

func TestApplyProductionDefaults_InProductionWithRedisEnv(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "ai-redis-ytykne:6379")
	t.Setenv(productionRedisUsernameEnv, "default")
	t.Setenv(productionRedisPasswordEnv, "secret")

	var configData ConfigData
	applyProductionDefaults(&configData)

	require.NotNil(t, configData.VectorStoreConfig)
	assert.True(t, configData.VectorStoreConfig.Enabled)
	assert.Equal(t, vectorstore.VectorStoreTypeRedis, configData.VectorStoreConfig.Type)

	redisConfig, ok := configData.VectorStoreConfig.Config.(vectorstore.RedisConfig)
	require.True(t, ok)
	assert.Equal(t, "ai-redis-ytykne:6379", redisConfig.Addr.GetValue())
	assert.Equal(t, "default", redisConfig.Username.GetValue())
	assert.Equal(t, "secret", redisConfig.Password.GetValue())
	assert.True(t, redisConfig.Addr.FromEnv)
	assert.Equal(t, "env."+productionRedisAddrEnv, redisConfig.Addr.EnvVar)
}

func TestApplyProductionDefaults_RespectsExistingConfig(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "ai-redis-ytykne:6379")

	configData := ConfigData{
		VectorStoreConfig: &vectorstore.Config{
			Enabled: true,
			Type:    vectorstore.VectorStoreTypeWeaviate,
		},
	}
	applyProductionDefaults(&configData)

	assert.Equal(t, vectorstore.VectorStoreTypeWeaviate, configData.VectorStoreConfig.Type)
}
