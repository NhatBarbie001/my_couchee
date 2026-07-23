hash() {
  echo $(echo "$1" | tr -d '\n' | base64)
}

export ENV=$(hash production)
export NAMESPACE_RAW="coach-staging"

export PRODUCTION=$(hash true)
export STAGE=$(hash "staging")

export CLIENT_ID=$(hash "")
export CLIENT_SECRET=$(hash "")
export DOMAIN=$(hash "")
export FORM_CLIENT_ID=$(hash "")
export FORM_CLIENT_SECRET=$(hash "")
export FORM_REDIRECT_URI=$(hash "")
export LD_LIBRARY_PATH=$(hash "")
export MONGO_URI=$(hash "")
export NODE_ENV=$(hash "")
export OPENAI_API_KEY=$(hash "")
export REDIRECT_URI=$(hash "")
export SERVICE_3000_NAME=$(hash "")
export SERVICE_NAME=$(hash "")
export SERVICE_TAGS=$(hash "")
export FRONTEND_URL=$(hash "")

# gen
envsubst < ./secrets.template.yml > gen.secrets-${NAMESPACE_RAW}.yml
