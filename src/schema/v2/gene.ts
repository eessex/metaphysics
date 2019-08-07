import { getPagingParameters, pageable } from "relay-cursor-paging"
import { connectionDefinitions, connectionFromArraySlice } from "graphql-relay"
import _ from "lodash"
import cached from "./fields/cached"
import Artwork from "./artwork"
import Artist, { artistConnection } from "./artist"
import Image from "./image"
import {
  queriedForFieldsOtherThanBlacklisted,
  convertConnectionArgsToGravityArgs,
} from "lib/helpers"
import { NodeInterface, SlugAndInternalIDFields } from "./object_identification"
import {
  GraphQLObjectType,
  GraphQLString,
  GraphQLNonNull,
  GraphQLList,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLFieldConfig,
} from "graphql"
import { ResolverContext } from "types/graphql"

const SUBJECT_MATTER_MATCHES = [
  "content",
  "medium",
  "concrete contemporary",
  "abstract contemporary",
  "concept",
  "technique",
  "appearance genes",
]

const SUBJECT_MATTER_REGEX = new RegExp(SUBJECT_MATTER_MATCHES.join("|"), "i")

export const GeneType = new GraphQLObjectType<any, ResolverContext>({
  name: "Gene",
  interfaces: [NodeInterface],
  fields: () => {
    // Avoiding a require circle
    const {
      default: filterArtworks,
      ArtworkFilterAggregations,
      filterArtworksArgs,
      FilterArtworksCounts,
    } = require("./filter_artworks")

    return {
      ...SlugAndInternalIDFields,
      cached,
      artists: {
        type: artistConnection.connectionType,
        args: pageable(),
        resolve: ({ id, counts }, options, { geneArtistsLoader }) => {
          const parsedOptions = _.omit(
            convertConnectionArgsToGravityArgs(options),
            "page"
          )
          const gravityOptions = _.extend(parsedOptions, {
            exclude_artists_without_artworks: true,
          })
          return geneArtistsLoader(id, gravityOptions).then(response => {
            return connectionFromArraySlice(response, options, {
              arrayLength: counts.artists,
              sliceStart: gravityOptions.offset,
            })
          })
        },
      },
      artworks: {
        type: connectionDefinitions({
          name: "GeneArtworks",
          nodeType: Artwork.type,
          connectionFields: {
            aggregations: ArtworkFilterAggregations,
            counts: FilterArtworksCounts,
          },
        }).connectionType,
        args: pageable(filterArtworksArgs),
        resolve: (
          { id },
          {
            aggregationPartnerCities,
            artistID,
            artistIDs,
            atAuction,
            attributionClass,
            dimensionRange,
            extraAggregationGeneIDs,
            includeArtworksByFollowedArtists,
            includeMediumFilterInAggregation,
            inquireableOnly,
            forSale,
            geneID,
            geneIDs,
            majorPeriods,
            partnerID,
            partnerCities,
            priceRange,
            saleID,
            tagID,
            keywordMatchExact,
            ..._options
          },
          { filterArtworksLoader }
        ) => {
          const options: any = {
            aggregation_partner_cities: aggregationPartnerCities,
            artist_id: artistID,
            artist_ids: artistIDs,
            at_auction: atAuction,
            attribution_class: attributionClass,
            dimension_range: dimensionRange,
            extra_aggregation_gene_ids: extraAggregationGeneIDs,
            include_artworks_by_followed_artists: includeArtworksByFollowedArtists,
            include_medium_filter_in_aggregation: includeMediumFilterInAggregation,
            inquireable_only: inquireableOnly,
            for_sale: forSale,
            gene_id: geneID,
            gene_ids: geneIDs,
            major_periods: majorPeriods,
            partner_id: partnerID,
            partner_cities: partnerCities,
            price_range: priceRange,
            sale_id: saleID,
            tag_id: tagID,
            keyword_match_exact: keywordMatchExact,
            ..._options,
          }

          const gravityOptions = convertConnectionArgsToGravityArgs(options)
          // Do some massaging of the options for ElasticSearch
          gravityOptions.aggregations = options.aggregations || []
          gravityOptions.aggregations.push("total")
          // Remove medium if we are trying to get all mediums
          if (gravityOptions.medium === "*" || !gravityOptions.medium) {
            delete gravityOptions.medium
          }
          // Manually set the gene_id to the current id
          gravityOptions.gene_id = id
          /**
           * FIXME: There’s no need for this loader to be authenticated (and not cache data), unless the
           *        `include_artworks_by_followed_artists` argument is given. Perhaps we can have specialized loaders
           *        that compose authenticated and unauthenticated loaders based on the request?
           *        Here’s an example of such a setup https://gist.github.com/alloy/69bb274039ecd552de76c3f1739c519e
           */
          return filterArtworksLoader(gravityOptions).then(
            ({ aggregations, hits }) => {
              return Object.assign(
                { aggregations }, // Add data to connection so the `aggregations` connection field can resolve it
                connectionFromArraySlice(hits, options, {
                  arrayLength: aggregations.total.value,
                  sliceStart: gravityOptions.offset,
                })
              )
            }
          )
        },
      },
      description: {
        type: GraphQLString,
      },
      displayName: {
        type: GraphQLString,
        resolve: ({ display_name }) => display_name,
      },
      filteredArtworks: filterArtworks("gene_id"),
      href: {
        type: GraphQLString,
        resolve: ({ id }) => `/gene/${id}`,
      },
      image: Image,
      isPublished: {
        type: GraphQLBoolean,
        resolve: ({ published }) => published,
      },
      isFollowed: {
        type: GraphQLBoolean,
        resolve: ({ id }, _args, { followedGeneLoader }) => {
          if (!followedGeneLoader) return false
          return followedGeneLoader(id).then(({ is_followed }) => is_followed)
        },
      },
      mode: {
        type: GraphQLString,
        resolve: ({ type }) => {
          const isSubjectMatter =
            type && type.name && type.name.match(SUBJECT_MATTER_REGEX)
          return isSubjectMatter ? "artworks" : "artist"
        },
      },
      name: {
        type: GraphQLString,
      },
      similar: {
        type: geneConnection, // eslint-disable-line no-use-before-define
        args: pageable({
          excludeGeneIDs: {
            type: new GraphQLList(GraphQLString),
            description:
              "Array of gene ids (not slugs) to exclude, may result in all genes being excluded.",
          },
        }),
        description: "A list of genes similar to the specified gene",
        resolve: (gene, { excludeGeneIDs }, { similarGenesLoader }) => {
          const options: any = {
            exclude_gene_ids: excludeGeneIDs,
          }
          const { limit: size, offset } = getPagingParameters(options)
          const gravityArgs = {
            size,
            offset,
            exclude_gene_ids: options.exclude_gene_ids,
            total_count: true,
          }

          return similarGenesLoader(gene.id, gravityArgs).then(
            ({ body, headers }) => {
              const genes = body
              const totalCount = parseInt(headers["x-total-count"] || "0", 10)

              return connectionFromArraySlice(genes, options, {
                arrayLength: totalCount,
                sliceStart: offset,
              })
            }
          )
        },
      },
      trendingArtists: {
        type: new GraphQLList(Artist.type),
        args: {
          sample: {
            type: GraphQLInt,
          },
        },
        resolve: ({ id }, options, { trendingArtistsLoader }) => {
          return trendingArtistsLoader({
            gene: id,
          }).then(artists => {
            if (_.has(options, "sample")) {
              return _.take(_.shuffle(artists), options.sample)
            }
            return artists
          })
        },
      },
    }
  },
})

const Gene: GraphQLFieldConfig<void, ResolverContext> = {
  type: GeneType,
  args: {
    id: {
      description: "The slug or ID of the Gene",
      type: new GraphQLNonNull(GraphQLString),
    },
  },
  resolve: (_root, { id }, { geneLoader }, { fieldNodes }) => {
    // If you are just making an artworks call ( e.g. if paginating )
    // do not make a Gravity call for the gene data.
    const blacklistedFields = ["filteredArtworks", "id", "internalID"]
    if (queriedForFieldsOtherThanBlacklisted(fieldNodes, blacklistedFields)) {
      return geneLoader(id)
    }

    // The family and browsable are here so that the type system's `isTypeOf`
    // resolves correctly when we're skipping gravity data
    return { id, published: null, browseable: null }
  },
}

export default Gene

export const geneConnection = connectionDefinitions({
  nodeType: Gene.type,
}).connectionType
