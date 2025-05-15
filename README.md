# TODO

Describe this more

## pseudo syntax

```html
All = (<Spec> \n)*

Spec = (<Package> <Space>)*

Space = ' '

Package = <Name>(<Equals> <VersionSpecifier>)?

Name = "A valid package name"

Equals = '='

VersionSpecifier = <SpecialVersionSpecifier> | <PartialSemverVersion>

SpecialVersionSpecifier = <SameAsRestVersionSpecifier>

SameAsRestVersionSpecifier = '!'

PartialSemverVersion = <Digits> (<Point> <Digits> (<Point> <Digits> (<Slash> <Digits>)? )? )?

Digits = <Digit> +

Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' 

Point = '.'

Slash = '-'
```

## Notes

A version can be a partial semver version or one of the special meanings, it also can be empty, which is equal to the newest one

You can install a few packages in the same pacman call, by sepewrating them by space, so that e.g. `gcc-libs` and `gcc` are installed in the same go.
Otherwise, you can seperate them with `\n` to install each one individually.
